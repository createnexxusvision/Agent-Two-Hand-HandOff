import { describe, expect, it } from "vitest";
import { PayPalClient, SANDBOX_API_BASE } from "@handoff/paypal";
import { ZERO_HASH, type Sha256Ref } from "@handoff/trust";
import { approvalWindow } from "../src/approval.ts";
import { decide, type DecideInput } from "../src/decide.ts";
import { DEMO_RECEIVERS, demoMandate } from "../src/demo-studio.ts";
import { executePayRun, payRunBatchId, PolicyViolation, type Payable } from "../src/execute.ts";

const now = new Date("2026-11-06T16:05:00.000Z");
const h = (c: string) => `sha256:${c.repeat(64)}` as Sha256Ref;

function decision(task: DecideInput["task"], deliverySeq: number, verdict: DecideInput["verdict"], weekToDateMinor = 0) {
  return decide({
    mandate: demoMandate(),
    mandateSignatureValid: true,
    mandateRevoked: false,
    task,
    deliverySeq,
    verdict,
    payee: { screening: { result: "clear", listSha256: ZERO_HASH }, taxForm: "W-9" },
    facts: { weekToDateMinor, payeeYearToDateMinor: 0, payeeYearToDatePayments: 0, paidDecisionKeys: new Set() },
    now,
  });
}

const short01 = decision({ taskId: "T-101", payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1 }, 7, { seq: 11, pass: true, reasons: [] });
const short02 = decision({ taskId: "T-102", payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1 }, 8, { seq: 12, pass: true, reasons: [] }, 4000);
const short03 = decision({ taskId: "T-103", payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1 }, 9, { seq: 13, pass: false, reasons: ["16:9"] }, 8000);
const thumbs = decision({ taskId: "T-104", payeeId: "ana", rateLineId: "thumb-pack-v1", quantity: 1 }, 10, { seq: 14, pass: true, reasons: [] }, 8000);

function fakeClient() {
  const bodies: unknown[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ batch_header: { payout_batch_id: "B-1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } }), { status: 201 });
  }) as typeof fetch;
  const client = new PayPalClient({ apiBase: SANDBOX_API_BASE, clientId: "id", clientSecret: "s" }, { fetch: fetchImpl, log: () => {} });
  return { client, bodies };
}

const resolveReceiver = async (payeeId: string) => DEMO_RECEIVERS[payeeId as keyof typeof DEMO_RECEIVERS];

describe("pay run", () => {
  const thumbsApproved: Payable = {
    decision: thumbs,
    decisionHash: h("c"),
    approval: { decisionHash: h("c"), decisionKey: thumbs.decisionKey, approved: true, ...approvalWindow(new Date("2026-11-06T16:00:00.000Z")) },
  };

  it("pays exactly the payable decisions, $230.00 in one batch", async () => {
    const { client, bodies } = fakeClient();
    const result = await executePayRun({
      client,
      payables: [{ decision: short01, decisionHash: h("a") }, { decision: short02, decisionHash: h("b") }, thumbsApproved],
      resolveReceiver,
      now,
      emailSubject: "Payment from Maya's studio",
    });
    const body = bodies[0] as { sender_batch_header: { sender_batch_id: string }; items: { receiver: string; amount: { value: string } }[] };
    expect(body.items.map((i) => [i.receiver, i.amount.value])).toEqual([
      ["theo@example.com", "40.00"],
      ["theo@example.com", "40.00"],
      ["ana@example.com", "150.00"],
    ]);
    expect(result.items.reduce((sum, i) => sum + i.amountMinor, 0)).toBe(23000);
    expect(body.sender_batch_header.sender_batch_id).toBe(result.senderBatchId);
  });

  it("derives the same batch id for the same decisions in any order", () => {
    expect(payRunBatchId([h("a"), h("b"), h("c")])).toBe(payRunBatchId([h("c"), h("a"), h("b")]));
    expect(payRunBatchId([h("a"), h("b")])).not.toBe(payRunBatchId([h("a"), h("c")]));
  });

  it("refuses a blocked decision", async () => {
    const { client, bodies } = fakeClient();
    await expect(
      executePayRun({ client, payables: [{ decision: short03, decisionHash: h("d") }], resolveReceiver, now, emailSubject: "x" }),
    ).rejects.toThrow(PolicyViolation);
    expect(bodies).toHaveLength(0);
  });

  it("refuses an over-threshold payout without a valid approval", async () => {
    const { client, bodies } = fakeClient();
    await expect(
      executePayRun({ client, payables: [{ decision: thumbs, decisionHash: h("c") }], resolveReceiver, now, emailSubject: "x" }),
    ).rejects.toThrow(/waiting for the creator's approval/);
    await expect(
      executePayRun({ client, payables: [{ ...thumbsApproved, decisionHash: h("e") }], resolveReceiver, now, emailSubject: "x" }),
    ).rejects.toThrow(/different decision/);
    expect(bodies).toHaveLength(0);
  });

  it("refuses the same decision twice in one run", async () => {
    const { client } = fakeClient();
    await expect(
      executePayRun({
        client,
        payables: [{ decision: short01, decisionHash: h("a") }, { decision: short01, decisionHash: h("a") }],
        resolveReceiver,
        now,
        emailSubject: "x",
      }),
    ).rejects.toThrow(/twice/);
  });
});
