import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";

/** The portable ledger export. Anyone can check it offline with `pnpm verify ledger.json`. */
export async function GET() {
  const { engine } = await getEngine();
  const ledger = await engine.config.store.exportLedger();
  return new Response(JSON.stringify(ledger, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="ledger.json"' },
  });
}
