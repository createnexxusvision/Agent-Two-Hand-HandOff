import { agentModel, streamStudioTurn, TurnBudget, TurnPacer, type StudioTurnRequest } from "@handoff/agents";

export const dynamic = "force-dynamic";

/**
 * One model turn for the AG Studio assistant on /ledger. Studio runs its agents in the browser and
 * executes their tool calls there, against the dashboard only; this route just answers turns with
 * the server's model key. Same-origin only, size-capped and rate-limited, because it spends the
 * free-tier quota the public demo depends on.
 */
const MAX_BODY_BYTES = 1_500_000;
const state = globalThis as unknown as { __studioBudget?: TurnBudget; __studioPacer?: TurnPacer; __studioSignatures?: Map<string, string> };
const budget = (state.__studioBudget ??= new TurnBudget({
  perClient: Number(process.env.HANDOFF_STUDIO_TURNS_PER_10_MIN ?? 60),
  windowMs: 10 * 60_000,
  perDay: Number(process.env.HANDOFF_STUDIO_TURNS_PER_DAY ?? 400),
}));
// Below Gemini Flash-Lite's free 15 a minute, leaving room for the verifier on the same key.
const pacer = (state.__studioPacer ??= new TurnPacer(Number(process.env.HANDOFF_STUDIO_TURNS_PER_MINUTE ?? 12)));
const signatures = (state.__studioSignatures ??= new Map());

const fail = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ error: message }, { status, headers: { "cache-control": "no-store", ...headers } });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return new URL(origin).host === host;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, "The assistant only answers this site's own pages.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "Conversation too long; start a new thread.");

  let model;
  try {
    model = agentModel("analyst");
  } catch {
    return fail(503, "The AI assistant is off on this deployment (no model key). The dashboards still work.");
  }

  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const allowed = budget.take(client);
  if (!allowed.ok) {
    const message =
      allowed.reason === "day"
        ? "The assistant has used today's free AI quota for this demo. The dashboards still work; it resets at midnight UTC."
        : "You're sending turns quickly; give the assistant a minute.";
    return fail(429, message, { "retry-after": String(allowed.retryAfterS) });
  }

  if (!(await pacer.slot(75_000, request.signal))) return fail(429, "The assistant is busy; try again in a minute.", { "retry-after": "60" });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, "Conversation too long; start a new thread.");
  let turn: StudioTurnRequest;
  try {
    turn = JSON.parse(text) as StudioTurnRequest;
    if (!Array.isArray(turn.input)) throw new Error("input must be an array");
  } catch (e) {
    return fail(400, `Bad turn: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Newline-delimited JSON: {"event":…} per AG-UI event, then one {"complete":…} with the final response.
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: unknown) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      const run = streamStudioTurn({ model: model.model, modelId: model.modelId, request: turn, signatures, signal: request.signal });
      try {
        for (;;) {
          const next = await run.next();
          if (next.done) {
            line({ complete: next.value });
            if (next.value.error) console.warn(JSON.stringify({ studio: "turn failed", code: next.value.error.code }));
            break;
          }
          line({ event: next.value });
        }
        controller.close();
      } catch {
        // The reader went away mid-turn; the model call was aborted with the request.
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
