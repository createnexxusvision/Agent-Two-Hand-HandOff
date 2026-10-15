import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";

/** Read-only data for the ledger dashboards: receipts with chain status, budget, tax totals, flags. */
export async function GET() {
  const { engine } = await getEngine();
  return Response.json(await engine.dashboard(), { headers: { "cache-control": "no-store" } });
}
