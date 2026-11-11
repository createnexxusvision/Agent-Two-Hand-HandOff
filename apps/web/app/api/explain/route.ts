import { TurnBudget } from "@handoff/agents";
import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The explainer agent's summary of the current week. Display-only: nothing here pays, approves or
 * blocks anything, and the summary is not stored as a receipt. Cached per ledger head, and rate-
 * limited because a fresh summary spends the free model quota the demo shares.
 */
const state = globalThis as unknown as { __explainBudget?: TurnBudget };
const budget = (state.__explainBudget ??= new TurnBudget({ perClient: 10, windowMs: 10 * 60_000, perDay: 200 }));

export async function GET(request: Request) {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const allowed = budget.take(client);
  if (!allowed.ok) {
    return Response.json({ error: "Too many summaries requested; try again in a few minutes." }, { status: 429, headers: { "retry-after": String(allowed.retryAfterS) } });
  }
  const { engine } = await getEngine();
  return Response.json(await engine.explain(), { headers: { "cache-control": "no-store" } });
}
