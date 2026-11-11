/**
 * pnpm anchors:publish [ledger url or file]   pnpm anchors:check [ledger url or file]
 *
 * Git anchoring. Every Merkle checkpoint the ledger signs is copied, as a plain-text note, into the
 * public anchors/ directory of this repository. A copy outside the database means the database
 * owner cannot quietly rewrite history: `pnpm verify ledger.json --anchors anchors` fails if any
 * published checkpoint differs from the ledger, or is missing from it.
 *
 *   publish  verifies the ledger against what is already published, then adds notes for new
 *            checkpoints. Notes are append-only: an existing note is never rewritten.
 *   check    verifies only; writes nothing. Exits 1 on any mismatch.
 *
 * The source defaults to the live site. Pass a URL or a ledger.json path to use another.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkpointNote, verifyLedger, type LedgerFile } from "../../packages/trust/src/index.ts";

const DIR = process.env.ANCHORS_DIR ?? "anchors";
const DEFAULT_SOURCE = "https://agent-two-hand-handoff.onrender.com/api/ledger";
const [mode, source = DEFAULT_SOURCE] = process.argv.slice(2);
if (mode !== "publish" && mode !== "check") {
  console.log("usage: anchors.ts publish|check [ledger url or file]");
  process.exit(2);
}

async function load(from: string): Promise<LedgerFile> {
  if (/^https?:\/\//.test(from)) {
    const res = await fetch(from, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`could not fetch the ledger: HTTP ${res.status}`);
    return (await res.json()) as LedgerFile;
  }
  return JSON.parse(readFileSync(from, "utf8")) as LedgerFile;
}

const name = (size: number) => `checkpoint-${String(size).padStart(6, "0")}.note`;
mkdirSync(DIR, { recursive: true });
const published = readdirSync(DIR).filter((f) => f.endsWith(".note")).sort().map((f) => readFileSync(join(DIR, f), "utf8"));

const ledger = await load(source);
const report = verifyLedger(ledger, published);
const problems = [...report.chain.failures.map((f) => `receipt #${f.seq} ${f.code}: ${f.message}`), ...report.checkpoints.flatMap((c) => c.problems.map((p) => `checkpoint ${c.treeSize}: ${p}`))];
if (problems.length > 0) {
  console.log(`Anchors: MISMATCH. The ledger no longer agrees with what was published.`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
const matched = report.checkpoints.filter((c) => c.anchored === "matches").length;

let added = 0;
if (mode === "publish") {
  for (const cp of ledger.checkpoints) {
    const file = join(DIR, name(cp.treeSize));
    if (existsSync(file)) continue;
    writeFileSync(file, checkpointNote(cp), { flag: "wx" });
    console.log(`  + ${file}`);
    added++;
  }
}
console.log(`Anchors: OK. ${ledger.receipts.length} receipts verified; ${matched} published checkpoints match${mode === "publish" ? `; ${added} new published` : ""}.`);
