/**
 * Server half of the AG Studio chat. Studio runs its agents in the browser and asks an adapter for
 * one model turn at a time; the adapter posts the turn here, and this module answers it with the
 * configured model (Gemini on the free tier, or Claude) through the AI SDK.
 *
 * Nothing here executes a tool. The model's tool calls are streamed back to Studio, which runs
 * them against the dashboard in the reader's browser. Studio's tools edit widgets and run
 * queries; none of them can reach PayPal, the policy engine or the receipt store.
 *
 * The types below mirror AG Studio's adapter protocol (AgLlmRequest, AgAiConversationItem,
 * AgAiEvent, AgLlmResponse) structurally, so this package does not depend on the Studio package.
 */
import { jsonSchema, Output, streamText, tool, type JSONSchema7, type LanguageModel, type ModelMessage, type ToolSet } from "ai";

type Status = "in_progress" | "completed" | "incomplete";

export type StudioItem =
  | { type: "message"; role: "user" | "system"; content: { type: string; text?: string }[] }
  | { type: "message"; role: "assistant"; content: ({ type: "text"; text: string } | { type: "refusal"; refusal: string })[] }
  | { type: "function_call"; callId: string; name: string; arguments: string }
  | { type: "function_call_output"; callId: string; output: string }
  | { type: "reasoning" };

export type StudioToolSchema = { name: string; description: string; parameters: Record<string, unknown>; kind?: string };

export type StudioTurnRequest = {
  input: StudioItem[];
  instructions?: string;
  tools?: StudioToolSchema[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?: { type: "text" } | { type: "json"; name: string; description?: string; schema: Record<string, unknown> };
};

export type StudioEvent =
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "REASONING_MESSAGE_START"; messageId: string; role: "reasoning" }
  | { type: "REASONING_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "REASONING_MESSAGE_END"; messageId: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string };

export type StudioOutputItem =
  | { id: string; kind: "output"; type: "message"; role: "assistant"; status: Status; content: { type: "text"; text: string; annotations: [] }[] }
  | { id: string; kind: "output"; type: "function_call"; callId: string; name: string; arguments: string; status: Status };

export type StudioTurnResponse = {
  id: string;
  createdAt: number;
  status: "completed" | "failed" | "incomplete";
  output: StudioOutputItem[];
  error?: { code: string; message: string };
  incompleteDetails?: { reason?: "max_output_tokens" | "content_filter" };
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; reasoningTokens?: number };
  model?: string;
};

/** Gemini 3 wants each function call's thought signature back on the next turn; Studio's history drops it. */
export type SignatureCache = Map<string, string>;
const SIGNATURE_CACHE_LIMIT = 2000;

function remember(cache: SignatureCache, callId: string, signature: string): void {
  cache.set(callId, signature);
  if (cache.size > SIGNATURE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** Studio's conversation items as AI SDK messages: calls grouped per assistant turn, results per tool turn. */
export function toModelMessages(items: readonly StudioItem[], signatures: SignatureCache = new Map()): { system: string[]; messages: ModelMessage[] } {
  const system: string[] = [];
  const messages: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  let assistant: Extract<ModelMessage, { role: "assistant" }> | null = null;
  let results: Extract<ModelMessage, { role: "tool" }> | null = null;
  const flush = () => {
    if (assistant) messages.push(assistant);
    if (results) messages.push(results);
    assistant = null;
    results = null;
  };
  const assistantParts = () => {
    if (results) flush();
    assistant ??= { role: "assistant", content: [] };
    return assistant.content as Exclude<typeof assistant.content, string>;
  };

  for (const item of items) {
    switch (item.type) {
      case "message": {
        if (item.role === "assistant") {
          for (const c of item.content) assistantParts().push({ type: "text", text: c.type === "text" ? c.text : c.refusal });
          break;
        }
        const text = item.content.map((c) => c.text ?? "").join("\n");
        flush();
        // Gemini takes system text only up front; later system notes travel as user text.
        if (item.role === "system" && messages.length === 0) system.push(text);
        else messages.push({ role: "user", content: item.role === "system" ? `[Studio note] ${text}` : text });
        break;
      }
      case "function_call": {
        toolNames.set(item.callId, item.name);
        const signature = signatures.get(item.callId);
        assistantParts().push({
          type: "tool-call",
          toolCallId: item.callId,
          toolName: item.name,
          input: safeJson(item.arguments),
          ...(signature ? { providerOptions: { google: { thoughtSignature: signature } } } : {}),
        });
        break;
      }
      case "function_call_output": {
        if (assistant) {
          messages.push(assistant);
          assistant = null;
        }
        results ??= { role: "tool", content: [] };
        results.content.push({ type: "tool-result", toolCallId: item.callId, toolName: toolNames.get(item.callId) ?? "unknown", output: { type: "text", value: item.output } });
        break;
      }
      default:
        break;
    }
  }
  flush();
  return { system, messages: withAnsweredCalls(messages) };
}

/** A call left unanswered (a cancelled run) would fail the request, so it gets an explicit "no result". */
function withAnsweredCalls(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    out.push(m);
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const calls = m.content.filter((p) => p.type === "tool-call");
    if (calls.length === 0) continue;
    const next = messages[i + 1];
    const answered = new Set(next?.role === "tool" ? next.content.flatMap((p) => (p.type === "tool-result" ? [p.toolCallId] : [])) : []);
    const missing = calls.filter((c) => !answered.has(c.toolCallId));
    if (missing.length === 0) continue;
    const filler = missing.map((c) => ({ type: "tool-result" as const, toolCallId: c.toolCallId, toolName: c.toolName, output: { type: "text" as const, value: "No result: the run was stopped before this call finished." } }));
    if (next?.role === "tool") next.content.push(...filler);
    else out.push({ role: "tool", content: filler });
  }
  return out;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function toolSet(schemas: readonly StudioToolSchema[] = []): ToolSet {
  const tools: ToolSet = {};
  for (const s of schemas) {
    if (s.kind === "provided") continue; // Provider-hosted tools are OpenAI-specific; Gemini has none to match.
    tools[s.name] = tool({ description: s.description, inputSchema: jsonSchema(s.parameters as JSONSchema7) });
  }
  return tools;
}

function toolChoiceFor(choice: StudioTurnRequest["toolChoice"]) {
  if (!choice || typeof choice === "string") return choice;
  return { type: "tool" as const, toolName: choice.name };
}

/** Quota and overload errors read as "try again later", not as a broken dashboard. */
export function describeModelError(error: unknown): { code: string; message: string } {
  const text = error instanceof Error ? error.message : String(error);
  const status = (error as { statusCode?: number; lastError?: { statusCode?: number } })?.statusCode ?? (error as { lastError?: { statusCode?: number } })?.lastError?.statusCode;
  if (status === 429 || /quota|rate limit|resource.?exhausted/i.test(text)) {
    return { code: "rate_limited", message: "The free AI quota is used up for the moment. The dashboard still works; try the assistant again in a minute." };
  }
  if (status === 503 || /overloaded|unavailable/i.test(text)) return { code: "unavailable", message: "The model is busy right now. Try again in a moment." };
  return { code: "model_error", message: text.slice(0, 300) };
}

export type StudioTurnOptions = {
  model: LanguageModel;
  modelId: string;
  request: StudioTurnRequest;
  signatures?: SignatureCache;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  newId?: () => string;
};

/** Answers one Studio turn: yields AG-UI content events as they stream, then returns the final response. */
export async function* streamStudioTurn(options: StudioTurnOptions): AsyncGenerator<StudioEvent, StudioTurnResponse> {
  const { model, modelId, request, signal } = options;
  const signatures = options.signatures ?? new Map<string, string>();
  const newId = options.newId ?? (() => crypto.randomUUID());
  const responseId = `resp_${newId()}`;
  const response: StudioTurnResponse = { id: responseId, createdAt: Date.now(), status: "completed", output: [], model: modelId };
  const { system, messages } = toModelMessages(request.input, signatures);
  const tools = toolSet(request.tools);
  const format = request.responseFormat?.type === "json" ? request.responseFormat : null;

  const texts = new Map<string, Extract<StudioOutputItem, { type: "message" }>>();
  const started = new Set<string>();
  const ended = new Set<string>();
  const args = new Map<string, string>();

  try {
    const result = streamText({
      model,
      system: [request.instructions, ...system].filter(Boolean).join("\n\n") || undefined,
      messages,
      ...(Object.keys(tools).length > 0 ? { tools, toolChoice: toolChoiceFor(request.toolChoice) } : {}),
      ...(format ? { output: Output.object({ schema: jsonSchema(format.schema as JSONSchema7), name: format.name, description: format.description }) } : {}),
      maxOutputTokens: options.maxOutputTokens ?? 4096,
      maxRetries: 2,
      abortSignal: signal,
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-start": {
          const messageId = `${responseId}-m${part.id}`;
          const item = { id: messageId, kind: "output" as const, type: "message" as const, role: "assistant" as const, status: "completed" as const, content: [{ type: "text" as const, text: "", annotations: [] as [] }] };
          texts.set(part.id, item);
          response.output.push(item);
          yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
          break;
        }
        case "text-delta": {
          const item = texts.get(part.id);
          if (!item || !part.text) break;
          item.content[0]!.text += part.text;
          yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: part.text };
          break;
        }
        case "text-end": {
          const item = texts.get(part.id);
          if (item) yield { type: "TEXT_MESSAGE_END", messageId: item.id };
          break;
        }
        case "reasoning-start":
          yield { type: "REASONING_MESSAGE_START", messageId: `${responseId}-r${part.id}`, role: "reasoning" };
          break;
        case "reasoning-delta":
          if (part.text) yield { type: "REASONING_MESSAGE_CONTENT", messageId: `${responseId}-r${part.id}`, delta: part.text };
          break;
        case "reasoning-end":
          yield { type: "REASONING_MESSAGE_END", messageId: `${responseId}-r${part.id}` };
          break;
        case "tool-input-start":
          started.add(part.id);
          args.set(part.id, "");
          yield { type: "TOOL_CALL_START", toolCallId: part.id, toolCallName: part.toolName };
          break;
        case "tool-input-delta":
          args.set(part.id, (args.get(part.id) ?? "") + part.delta);
          yield { type: "TOOL_CALL_ARGS", toolCallId: part.id, delta: part.delta };
          break;
        case "tool-input-end":
          ended.add(part.id);
          yield { type: "TOOL_CALL_END", toolCallId: part.id };
          break;
        case "tool-call": {
          const id = part.toolCallId;
          const full = JSON.stringify(part.input ?? {});
          const signature = (part.providerMetadata as { google?: { thoughtSignature?: string } } | undefined)?.google?.thoughtSignature;
          if (signature) remember(signatures, id, signature);
          if (!started.has(id)) yield { type: "TOOL_CALL_START", toolCallId: id, toolCallName: part.toolName };
          // Some providers send the arguments only on the final call part; Studio needs them as args deltas.
          if (!args.get(id)) yield { type: "TOOL_CALL_ARGS", toolCallId: id, delta: full };
          if (!ended.has(id)) yield { type: "TOOL_CALL_END", toolCallId: id };
          response.output.push({ id: `fc_${id}`, kind: "output", type: "function_call", callId: id, name: part.toolName, arguments: full, status: "completed" });
          break;
        }
        case "error":
          response.status = "failed";
          response.error = describeModelError(part.error);
          break;
        case "finish": {
          const u = part.totalUsage;
          response.usage = { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, totalTokens: u.totalTokens, reasoningTokens: u.outputTokenDetails?.reasoningTokens };
          if (part.finishReason === "length") {
            response.status = "incomplete";
            response.incompleteDetails = { reason: "max_output_tokens" };
          } else if (part.finishReason === "content-filter") {
            response.status = "incomplete";
            response.incompleteDetails = { reason: "content_filter" };
          }
          break;
        }
        default:
          break;
      }
    }
  } catch (e) {
    response.status = "failed";
    response.error = signal?.aborted ? { code: "cancelled", message: "The run was cancelled." } : describeModelError(e);
  }
  // An empty text block helps no one; drop it from the final output.
  response.output = response.output.filter((o) => o.type !== "message" || o.content[0]!.text.length > 0);
  return response;
}
