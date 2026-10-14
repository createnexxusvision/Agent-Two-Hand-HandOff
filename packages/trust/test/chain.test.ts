import { describe, expect, it } from "vitest";
import { verifyChain } from "../src/chain.ts";
import { ed25519Signer, Keyring, type Signer } from "../src/keys.ts";
import { ReceiptLog, sealReceipt, type Receipt } from "../src/receipt.ts";
import { ZERO_HASH } from "../src/hash.ts";

const seed = (n: number) => new Uint8Array(32).fill(n);
const creator = ed25519Signer("creator-2026-11", "creator", seed(1));
const ops = ed25519Signer("ops-agent-2026-11", "ops-agent", seed(2));
const policy = ed25519Signer("policy-engine-2026-11", "policy-engine", seed(3));
const keyring = () => new Keyring([creator.publicKey, ops.publicKey, policy.publicKey]);

function buildChain(count: number): Receipt[] {
  const log = new ReceiptLog();
  log.append("MANDATE", "creator", { mandateId: "m-1", weeklyCapMinor: 30000 }, [creator], "2026-11-02T09:00:00.000Z");
  for (let i = 2; i <= count; i++) {
    const [type, actor, signer]: [Receipt["type"], Receipt["actor"], Signer] =
      i % 2 === 0 ? ["TASK", "ops-agent", ops] : ["DECISION", "policy-engine", policy];
    log.append(type, actor, { n: i, amountMinor: 4000 }, [signer], `2026-11-02T09:${String(i).padStart(2, "0")}:00.000Z`);
  }
  return log.all().map((r) => structuredClone(r));
}

describe("receipt chain", () => {
  it("verifies an untouched chain of 10 receipts", () => {
    const report = verifyChain(buildChain(10), keyring());
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(10);
  });

  it("reports the exact seq when a stored amount is edited", () => {
    const chain = buildChain(10);
    (chain[6]!.body as { amountMinor: number }).amountMinor = 40000;
    const report = verifyChain(chain, keyring());
    expect(report.ok).toBe(false);
    expect(report.firstBrokenSeq).toBe(7);
    expect(report.failures.map((f) => [f.seq, f.code])).toEqual([
      [7, "HASH_MISMATCH"],
      [8, "PREV_MISMATCH"],
    ]);
  });

  it("detects a re-hashed receipt through its signature", () => {
    const chain = buildChain(5);
    const tampered = chain[2]!;
    (tampered.body as { amountMinor: number }).amountMinor = 1;
    const impostor = ed25519Signer("policy-engine-2026-11", "policy-engine", seed(99));
    const resealed = sealReceipt({ ...tampered }, [impostor]);
    chain[2] = { ...resealed, sigs: tampered.sigs };
    const report = verifyChain(chain, keyring());
    expect(report.firstBrokenSeq).toBe(3);
    expect(report.failures.some((f) => f.code === "BAD_SIGNATURE")).toBe(true);
  });

  it("detects a deleted receipt in the middle", () => {
    const chain = buildChain(6);
    chain.splice(3, 1);
    const report = verifyChain(chain, keyring());
    expect(report.firstBrokenSeq).toBe(4);
    expect(report.failures[0]!.code).toBe("SEQ_GAP");
  });

  it("flips a verdict on any single-byte change in any receipt", () => {
    const original = buildChain(8);
    for (let i = 0; i < original.length; i++) {
      const chain = structuredClone(original);
      const r = chain[i]!;
      r.ts = r.ts.replace("2026", "2027");
      expect(verifyChain(chain, keyring()).firstBrokenSeq).toBe(i + 1);
    }
  });

  it("refuses to seal a record type with the wrong actor", () => {
    expect(() =>
      sealReceipt({ seq: 1, type: "DECISION", prev: ZERO_HASH, ts: "2026-11-02T09:00:00.000Z", actor: "ops-agent", body: {} }, [ops]),
    ).toThrow(/may not sign DECISION/);
  });

  it("refuses a signer whose key belongs to another actor", () => {
    expect(() =>
      sealReceipt({ seq: 1, type: "MANDATE", prev: ZERO_HASH, ts: "2026-11-02T09:00:00.000Z", actor: "creator", body: {} }, [ops]),
    ).toThrow(/belongs to ops-agent/);
  });

  it("rejects receipts signed by unknown or revoked keys", () => {
    const chain = buildChain(3);
    const ring = new Keyring([creator.publicKey, policy.publicKey, { ...ops.publicKey, revokedAt: "2026-11-01T00:00:00.000Z" }]);
    expect(verifyChain(chain, ring).failures.map((f) => f.code)).toContain("KEY_REVOKED");
    expect(verifyChain(chain, new Keyring([creator.publicKey])).failures.map((f) => f.code)).toContain("UNKNOWN_KEY");
  });

  it("rejects a forged receipt from an actor that may not sign its type", () => {
    const chain = buildChain(2);
    chain.push({ ...chain[1]!, seq: 3, prev: chain[1]!.hash, type: "PAYOUT" });
    const codes = verifyChain(chain, keyring()).failures.filter((f) => f.seq === 3).map((f) => f.code);
    expect(codes).toContain("ACTOR_NOT_ALLOWED");
  });
});
