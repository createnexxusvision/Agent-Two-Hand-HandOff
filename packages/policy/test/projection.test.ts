import { describe, expect, it } from "vitest";
import { ed25519Signer, ReceiptLog, ZERO_HASH, type Json } from "@handoff/trust";
import { approvalWindow } from "../src/approval.ts";
import { decide } from "../src/decide.ts";
import { demoMandate } from "../src/demo-studio.ts";
import { factsFor, project } from "../src/projection.ts";

const seed = (n: number) => new Uint8Array(32).fill(n);
const s = {
  creator: ed25519Signer("c", "creator", seed(1)),
  ops: ed25519Signer("o", "ops-agent", seed(2)),
  contractor: ed25519Signer("t", "contractor", seed(3)),
  verifier: ed25519Signer("v", "verifier", seed(4)),
  policy: ed25519Signer("p", "policy-engine", seed(5)),
  webhook: ed25519Signer("w", "webhook-handler", seed(6)),
};
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as { [k: string]: Json };
const mandate = demoMandate();
const now = new Date("2026-11-05T16:00:00.000Z");

function decisionFor(log: ReceiptLog, taskId: string, payeeId: string, rateLineId: string, weekToDateMinor: number) {
  log.append("TASK", "ops-agent", { taskId, mandateId: mandate.mandateId, payeeId, rateLineId, quantity: 1 }, [s.ops]);
  const delivery = log.append("DELIVERY", "contractor", { taskId }, [s.contractor]);
  const verdict = log.append("VERDICT", "verifier", { taskId, deliverySeq: delivery.seq, pass: true, reasons: [] }, [s.verifier]);
  const decision = decide({
    mandate,
    mandateSignatureValid: true,
    mandateRevoked: false,
    task: { taskId, payeeId, rateLineId, quantity: 1 },
    deliverySeq: delivery.seq,
    verdict: { seq: verdict.seq, pass: true, reasons: [] },
    payee: { screening: { result: "clear", listSha256: ZERO_HASH }, taxForm: "W-9" },
    facts: { weekToDateMinor, payeeYearToDateMinor: 0, payeeYearToDatePayments: 0, paidDecisionKeys: new Set() },
    now,
  });
  const receipt = log.append("DECISION", "policy-engine", json(decision), [s.policy]);
  return { decision, receipt };
}

function scenario() {
  const log = new ReceiptLog();
  log.append("MANDATE", "creator", { mandate: json(mandate) }, [s.creator], "2026-11-02T09:00:00.000Z");
  const short = decisionFor(log, "T-101", "theo", "short-edit-v1", 0);
  const thumbs = decisionFor(log, "T-104", "ana", "thumb-pack-v1", 4000);
  return { log, short, thumbs };
}

describe("projection", () => {
  it("rebuilds tasks, deliveries, verdicts and decisions from receipts", () => {
    const { log, short, thumbs } = scenario();
    const view = project(log.all());
    expect(view.mandates.get(mandate.mandateId)?.revoked).toBe(false);
    expect([...view.tasks.keys()]).toEqual(["T-101", "T-104"]);
    expect(view.deliveries.size).toBe(2);
    expect([...view.verdicts.values()].every((v) => v.pass)).toBe(true);
    expect(view.decisions.get(short.decision.decisionKey)?.decision.status).toBe("APPROVED");
    expect(view.decisions.get(thumbs.decision.decisionKey)?.decision.status).toBe("NEEDS_APPROVAL");
  });

  it("counts approved and pending amounts toward the week, and frees a declined one", () => {
    const { log, thumbs } = scenario();
    expect(factsFor(project(log.all()), mandate.mandateId, "theo", 2026).weekToDateMinor).toBe(19000);
    log.append(
      "APPROVAL",
      "creator",
      { decisionHash: thumbs.receipt.hash, decisionKey: thumbs.decision.decisionKey, approved: false, ...approvalWindow(now) },
      [s.creator],
    );
    expect(factsFor(project(log.all()), mandate.mandateId, "theo", 2026).weekToDateMinor).toBe(4000);
  });

  it("follows each payout through its webhook events", () => {
    const { log, short } = scenario();
    const key = short.decision.decisionKey;
    log.append("PAYOUT", "policy-engine", { senderBatchId: "pr-1", items: [{ senderItemId: key, payeeId: "theo", amountMinor: 4000 }] }, [s.policy], "2026-11-05T16:13:00.000Z");

    let facts = factsFor(project(log.all()), mandate.mandateId, "theo", 2026);
    expect(facts.paidDecisionKeys.has(key)).toBe(true);
    expect(facts.payeeYearToDateMinor).toBe(0);

    log.append("CONFIRMATION", "webhook-handler", { eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", senderItemId: key }, [s.webhook]);
    facts = factsFor(project(log.all()), mandate.mandateId, "theo", 2026);
    expect(project(log.all()).payouts.get(key)?.state).toBe("SUCCEEDED");
    expect([facts.payeeYearToDateMinor, facts.payeeYearToDatePayments]).toEqual([4000, 1]);
    expect(factsFor(project(log.all()), mandate.mandateId, "theo", 2027).payeeYearToDateMinor).toBe(0);
    expect(factsFor(project(log.all()), mandate.mandateId, "ana", 2026).payeeYearToDateMinor).toBe(0);
  });

  it("releases a returned payout from the week and from the paid set", () => {
    const { log, short } = scenario();
    const key = short.decision.decisionKey;
    log.append("PAYOUT", "policy-engine", { senderBatchId: "pr-1", items: [{ senderItemId: key, payeeId: "theo", amountMinor: 4000 }] }, [s.policy]);
    log.append("RETURN", "webhook-handler", { eventType: "PAYMENT.PAYOUTS-ITEM.RETURNED", senderItemId: key }, [s.webhook]);
    const facts = factsFor(project(log.all()), mandate.mandateId, "theo", 2026);
    expect(project(log.all()).payouts.get(key)?.state).toBe("RETURNED");
    expect(facts.paidDecisionKeys.has(key)).toBe(false);
    expect(facts.weekToDateMinor).toBe(15000);
  });

  it("marks a revoked mandate", () => {
    const { log } = scenario();
    log.append("REVOCATION", "creator", { mandateId: mandate.mandateId }, [s.creator]);
    expect(project(log.all()).mandates.get(mandate.mandateId)?.revoked).toBe(true);
  });
});
