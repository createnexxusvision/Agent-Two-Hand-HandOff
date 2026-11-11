import { getEngine } from "../../../../lib/engine";

export const dynamic = "force-dynamic";

/** The ledger as related tables for the AG Studio dashboards on /ledger, all derived from receipts. */
export async function GET() {
  const { engine } = await getEngine();
  return Response.json(await engine.studioData(), { headers: { "cache-control": "no-store" } });
}
