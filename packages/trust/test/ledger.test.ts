import { describe, expect, it } from "vitest";
import { checkpointNote, createCheckpoint, parseCheckpointNote, verifyCheckpointSignatures } from "../src/checkpoint.ts";
import { ed25519Signer, Keyring, mlDsa65Signer } from "../src/keys.ts";
import { LEDGER_FORMAT, verifyLedger, type LedgerFile } from "../src/ledger.ts";
import { ReceiptLog } from "../src/receipt.ts";

const seed = (n: number) => new Uint8Array(32).fill(n);
const creator = ed25519Signer("creator-2026-11", "creator", seed(1));
const policy = ed25519Signer("policy-engine-2026-11", "policy-engine", seed(3));
const cpEd = ed25519Signer("checkpoint-ed25519-2026-11", "system", seed(7));
const cpPq = mlDsa65Signer("checkpoint-mldsa65-2026-11", "system", seed(8));

function ledgerWith(receiptCount: number, checkpointAt: number[]): LedgerFile {
  const log = new ReceiptLog();
  const checkpoints = [];
  log.append("MANDATE", "creator", { mandateId: "m-1" }, [creator], "2026-11-02T09:00:00.000Z");
  for (let i = 2; i <= receiptCount; i++) {
    log.append("DECISION", "policy-engine", { n: i, amountMinor: 4000 }, [policy], "2026-11-02T10:00:00.000Z");
    if (checkpointAt.includes(i)) {
      checkpoints.push(createCheckpoint(log.all().map((r) => r.hash), [cpEd, cpPq], { issuedAt: "2026-11-02T11:00:00.000Z" }));
    }
  }
  return {
    format: LEDGER_FORMAT,
    keys: [creator.publicKey, policy.publicKey, cpEd.publicKey, cpPq.publicKey],
    receipts: structuredClone([...log.all()]),
    checkpoints,
  };
}

describe("checkpoints and offline verification", () => {
  it("co-signs checkpoints with Ed25519 and ML-DSA-65", () => {
    const ledger = ledgerWith(5, [5]);
    const cp = ledger.checkpoints[0]!;
    expect(cp.sigs.map((s) => s.alg)).toEqual(["Ed25519", "ML-DSA-65"]);
    const report = verifyCheckpointSignatures(cp, new Keyring(ledger.keys));
    expect(report.ok).toBe(true);
  });

  it("requires both signature algorithms", () => {
    const ledger = ledgerWith(4, [4]);
    const cp = { ...ledger.checkpoints[0]!, sigs: ledger.checkpoints[0]!.sigs.filter((s) => s.alg === "Ed25519") };
    expect(verifyCheckpointSignatures(cp, new Keyring(ledger.keys)).problems).toContain("missing a valid ML-DSA-65 signature");
  });

  it("passes a clean ledger with matching anchors", () => {
    const ledger = ledgerWith(23, [11, 23]);
    const anchors = ledger.checkpoints.map(checkpointNote);
    const report = verifyLedger(ledger, anchors);
    expect(report.ok).toBe(true);
    expect(report.checkpoints.map((c) => c.anchored)).toEqual(["matches", "matches"]);
  });

  it("catches an edited payout through the chain and the checkpoint", () => {
    const ledger = ledgerWith(23, [23]);
    (ledger.receipts[19]!.body as { amountMinor: number }).amountMinor = 40000;
    const report = verifyLedger(ledger, ledger.checkpoints.map(checkpointNote));
    expect(report.ok).toBe(false);
    expect(report.chain.firstBrokenSeq).toBe(20);
    expect(report.checkpoints[0]!.problems).toContain("root differs from the receipts stored now");
  });

  it("catches receipts deleted from the end, which a hash chain alone cannot see", () => {
    const ledger = ledgerWith(23, [23]);
    ledger.receipts = ledger.receipts.slice(0, 21);
    const report = verifyLedger(ledger);
    expect(report.chain.ok).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.checkpoints[0]!.problems[0]).toMatch(/covers 23 receipts but only 21 exist/);
  });

  it("catches a checkpoint rewritten in the database against its anchored copy", () => {
    const ledger = ledgerWith(10, [10]);
    const anchor = checkpointNote(ledger.checkpoints[0]!);
    ledger.receipts = ledger.receipts.slice(0, 9);
    ledger.checkpoints = [createCheckpoint(ledger.receipts.map((r) => r.hash), [cpEd, cpPq], { issuedAt: "2026-11-02T11:00:00.000Z" })];
    const report = verifyLedger(ledger, [anchor]);
    expect(report.ok).toBe(false);
    expect(report.checkpoints.some((c) => c.problems.some((p) => p.includes("anchored checkpoint of size 10 is missing")))).toBe(true);
  });

  it("round-trips a checkpoint note", () => {
    const cp = ledgerWith(3, [3]).checkpoints[0]!;
    expect(parseCheckpointNote(checkpointNote(cp))).toEqual({
      origin: cp.origin,
      treeSize: 3,
      root: cp.root,
      issuedAt: cp.issuedAt,
    });
  });
});
