import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { describeModelError, streamStudioTurn, toModelMessages, type StudioEvent, type StudioItem, type StudioTurnRequest } from "../src/studio-bridge.ts";
import { TurnBudget, TurnPacer } from "../src/turn-budget.ts";

const usage = { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };

function streamingModel(chunks: unknown[]) {
  return new MockLanguageModelV4({
    modelId: "mock",
    doStream: async () => ({ stream: simulateReadableStream({ chunks: chunks as never[] }) }),
  });
}

async function run(request: StudioTurnRequest, model: MockLanguageModelV4, signatures = new Map<string, string>()) {
  const events: StudioEvent[] = [];
  const turn = streamStudioTurn({ model, modelId: "mock", request, signatures, newId: () => "1" });
  for (;;) {
    const next = await turn.next();
    if (next.done) return { events, response: next.value };
    events.push(next.value);
  }
}

const user = (text: string): StudioItem => ({ type: "message", role: "user", content: [{ type: "text", text }] });

describe("studio bridge: history", () => {
  it("groups calls per assistant turn, results per tool turn, and returns thought signatures", () => {
    const { system, messages } = toModelMessages(
      [
        { type: "message", role: "system", content: [{ type: "text", text: "Be brief." }] },
        user("Is the ledger intact?"),
        { type: "message", role: "assistant", content: [{ type: "text", text: "Checking." }] },
        { type: "function_call", callId: "c1", name: "verify_ledger", arguments: "{}" },
        { type: "function_call", callId: "c2", name: "view_page", arguments: '{"pageId":"money"}' },
        { type: "function_call_output", callId: "c1", output: '{"ok":true}' },
        { type: "function_call_output", callId: "c2", output: "{}" },
        { type: "reasoning" },
        { type: "message", role: "system", content: [{ type: "text", text: "Page changed." }] },
      ],
      new Map([["c1", "sig-1"]]),
    );
    expect(system).toEqual(["Be brief."]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
    expect(messages[1]!.content).toEqual([
      { type: "text", text: "Checking." },
      { type: "tool-call", toolCallId: "c1", toolName: "verify_ledger", input: {}, providerOptions: { google: { thoughtSignature: "sig-1" } } },
      { type: "tool-call", toolCallId: "c2", toolName: "view_page", input: { pageId: "money" } },
    ]);
    expect((messages[2]!.content as { toolName: string }[]).map((p) => p.toolName)).toEqual(["verify_ledger", "view_page"]);
    expect(messages[3]).toEqual({ role: "user", content: "[Studio note] Page changed." });
  });

  it("answers a call the run never finished, so the next request is valid", () => {
    const { messages } = toModelMessages([user("Build a page"), { type: "function_call", callId: "c9", name: "add_widget", arguments: "{" }, user("Stop. Explain instead.")]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
    expect(messages[1]!.content).toEqual([{ type: "tool-call", toolCallId: "c9", toolName: "add_widget", input: {} }]);
    expect(JSON.stringify(messages[2])).toContain("No result");
  });
});

describe("studio bridge: one turn", () => {
  it("streams text and tool calls as AG-UI events and remembers the signature", async () => {
    const model = streamingModel([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", delta: "Checking the " },
      { type: "text-delta", id: "0", delta: "chain." },
      { type: "text-end", id: "0" },
      { type: "tool-call", toolCallId: "call-1", toolName: "verify_ledger", input: "{}", providerMetadata: { google: { thoughtSignature: "sig-9" } } },
      { type: "finish", finishReason: { unified: "tool-calls", raw: "STOP" }, usage },
    ]);
    const signatures = new Map<string, string>();
    const tools = [{ name: "verify_ledger", description: "Verify every receipt.", parameters: { type: "object", properties: {}, $defs: { x: { type: "string" } } } }];
    const { events, response } = await run({ input: [user("Is the ledger intact?")], instructions: "You audit.", tools, toolChoice: "auto" }, model, signatures);

    expect(events.map((e) => e.type)).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
    expect(response).toMatchObject({
      status: "completed",
      model: "mock",
      usage: { inputTokens: 12, outputTokens: 5 },
      output: [
        { type: "message", role: "assistant", content: [{ type: "text", text: "Checking the chain." }] },
        { type: "function_call", callId: "call-1", name: "verify_ledger", arguments: "{}" },
      ],
    });
    expect(signatures.get("call-1")).toBe("sig-9");

    // The tool's JSON Schema reaches the model untouched, and nothing executes it server-side.
    const call = model.doStreamCalls[0]!;
    expect(call.tools).toEqual([expect.objectContaining({ type: "function", name: "verify_ledger", inputSchema: tools[0]!.parameters })]);
    expect(JSON.stringify(call.prompt)).toContain("You audit.");
  });

  it("reports a quota error as a failed turn with a plain message", async () => {
    const model = new MockLanguageModelV4({
      modelId: "mock",
      doStream: async () => {
        throw Object.assign(new Error("Resource has been exhausted (e.g. check quota)."), { statusCode: 429 });
      },
    });
    const { response } = await run({ input: [user("hi")] }, model);
    expect(response.status).toBe("failed");
    expect(response.error?.code).toBe("rate_limited");
    expect(describeModelError(new Error("model is overloaded")).code).toBe("unavailable");
  });
});

describe("studio bridge: turn budget", () => {
  it("caps each client per window and everyone per UTC day", () => {
    let t = Date.parse("2026-10-15T23:58:00.000Z");
    const budget = new TurnBudget({ perClient: 2, windowMs: 60_000, perDay: 3 }, () => t);
    expect(budget.take("a")).toEqual({ ok: true, remainingToday: 2 });
    expect(budget.take("a").ok).toBe(true);
    expect(budget.take("a")).toEqual({ ok: false, reason: "client", retryAfterS: 60 });
    expect(budget.take("b")).toEqual({ ok: true, remainingToday: 0 });
    expect(budget.take("c")).toEqual({ ok: false, reason: "day", retryAfterS: 120 });
    t += 120_000; // A new UTC day resets the daily total.
    expect(budget.take("c")).toEqual({ ok: true, remainingToday: 2 });
  });
});

describe("studio bridge: turn pacer", () => {
  it("waits for a slot under the per-minute limit, and gives up past the longest wait", async () => {
    let t = 0;
    const slept: number[] = [];
    const pacer = new TurnPacer(2, () => t, async (ms) => {
      slept.push(ms);
      t += ms;
    });
    expect(await pacer.slot(90_000)).toBe(true);
    t += 10_000;
    expect(await pacer.slot(90_000)).toBe(true);
    expect(await pacer.slot(90_000)).toBe(true); // Waits until the first turn leaves the window.
    expect(slept).toEqual([50_025]);
    expect(await pacer.slot(1_000)).toBe(false);
  });
});
