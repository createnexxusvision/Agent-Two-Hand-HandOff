/**
 * Gate 3 (must pass): sign 10 records, verify the chain, change one byte, and confirm
 * verification names the exact broken seq. Extended for the trust upgrade: a dual-signed
 * checkpoint, and truncation that only the checkpoint can catch.
 */
import {
  createCheckpoint,
  ed25519Signer,
  Keyring,
  LEDGER_FORMAT,
  mlDsa65Signer,
  ReceiptLog,
  verifyChain,
  verifyLedger,
  type LedgerFile,
  type Receipt,
} from "@handoff/trust";

const results: [string, boolean][] = [];
const check = (name: string, ok: boolean) => results.push([name, ok]);

const creator = ed25519Signer("gate-creator", "creator");
const policy = ed25519Signer("gate-policy", "policy-engine");
const cpEd = ed25519Signer("gate-cp-ed", "system");
const cpPq = mlDsa65Signer("gate-cp-pq", "system");
const keys = [creator.publicKey, policy.publicKey, cpEd.publicKey, cpPq.publicKey];

const log = new ReceiptLog();
log.append("MANDATE", "creator", { mandateId: "gate" }, [creator]);
for (let i = 2; i <= 10; i++) log.append("DECISION", "policy-engine", { n: i, amountMinor: 4000 }, [policy]);
const receipts = (): Receipt[] => structuredClone([...log.all()]);

check("10 signed receipts verify", verifyChain(receipts(), new Keyring(keys)).ok);

for (let target = 1; target <= 10; target++) {
  const mutated = receipts();
  const bytes = Buffer.from(JSON.stringify(mutated[target - 1]!.body));
  bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 0x01;
  try {
    mutated[target - 1]!.body = JSON.parse(bytes.toString()) as Receipt["body"];
  } catch {
    mutated[target - 1]!.ts = mutated[target - 1]!.ts.replace(/.$/, "X");
  }
  const report = verifyChain(mutated, new Keyring(keys));
  check(`one changed byte in seq ${target} is reported at seq ${target}`, report.firstBrokenSeq === target);
}

const cp = createCheckpoint(log.all().map((r) => r.hash), [cpEd, cpPq]);
const ledger: LedgerFile = { format: LEDGER_FORMAT, keys, receipts: receipts(), checkpoints: [cp] };
check("checkpoint carries Ed25519 + ML-DSA-65 and verifies", verifyLedger(ledger).ok);
const truncated: LedgerFile = { ...ledger, receipts: receipts().slice(0, 8) };
check("hash chain alone accepts a truncated log", verifyChain(truncated.receipts, new Keyring(keys)).ok);
check("checkpoint catches the truncation", !verifyLedger(truncated).ok);

for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `Gate 3: FAIL (${failed} of ${results.length})` : `Gate 3: PASS (${results.length} checks)`);
process.exitCode = failed ? 1 : 0;
