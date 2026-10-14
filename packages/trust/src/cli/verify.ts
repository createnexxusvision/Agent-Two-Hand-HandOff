/**
 * pnpm verify [ledger.json] [--anchors <dir>]
 *
 * Verifies an exported ledger offline: every signature, every hash link, and every checkpoint
 * against the receipts as stored. Exits 1 on any failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyLedger, type LedgerFile } from "../ledger.ts";

function parseArgs(argv: string[]): { file: string; anchors?: string } {
  let file = "ledger.json";
  let anchors: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--anchors") anchors = argv[++i];
    else if (!arg.startsWith("-")) file = arg;
  }
  return { file, anchors };
}

const { file, anchors } = parseArgs(process.argv.slice(2));
const ledger = JSON.parse(readFileSync(file, "utf8")) as LedgerFile;
const notes = anchors
  ? readdirSync(anchors)
      .filter((f) => f.endsWith(".note"))
      .sort()
      .map((f) => readFileSync(join(anchors, f), "utf8"))
  : [];

const report = verifyLedger(ledger, notes);
const { chain } = report;

if (chain.ok) {
  console.log(`✓ seq 1–${chain.checked} signatures and links valid`);
} else {
  const first = chain.firstBrokenSeq!;
  if (first > 1) console.log(`✓ seq 1–${first - 1} signatures and links valid`);
  for (const f of chain.failures) console.log(`✗ seq ${f.seq} ${f.code}: ${f.message}`);
}

for (const cp of report.checkpoints) {
  const label = `checkpoint (size ${cp.treeSize})`;
  if (cp.problems.length === 0) {
    const anchorNote = cp.anchored === "matches" ? ", matches its anchored copy" : "";
    console.log(`✓ ${label}: Ed25519 + ML-DSA-65 valid, root matches${anchorNote}`);
  } else {
    for (const p of cp.problems) console.log(`✗ ${label}: ${p}`);
  }
}

if (report.ok) {
  console.log("OK");
} else {
  console.log(`exit 1 · broken at seq ${chain.firstBrokenSeq ?? "(checkpoint)"}`);
  process.exitCode = 1;
}
