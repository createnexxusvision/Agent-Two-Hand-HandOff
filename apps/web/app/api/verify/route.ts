import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";

/** Verifies every receipt signature, hash link and checkpoint right now, server-side. */
export async function GET() {
  const { engine } = await getEngine();
  const r = await engine.report();
  const last = r.checkpoints.at(-1);
  return Response.json(
    {
      ok: r.ok,
      receiptsChecked: r.chain.checked,
      firstBrokenSeq: r.chain.firstBrokenSeq ?? null,
      failures: r.chain.failures.slice(0, 5),
      latestCheckpoint: last ? { treeSize: last.treeSize, valid: last.problems.length === 0, signatures: "Ed25519 + ML-DSA-65" } : null,
      checkedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
