/**
 * The pay run: the only code in the project that may call PayPal Payouts.
 * It accepts nothing but policy decisions, and refuses any that are not payable.
 */
import { canonicalize, sha256, toHex, utf8, type Sha256Ref } from "@handoff/trust";
import type { PayPalClient } from "@handoff/paypal";
import { createPayoutBatch, getPayoutBatch, type PayoutBatch } from "@handoff/paypal/payouts";
import { checkApproval, type ApprovalBody } from "./approval.ts";
import type { Decision } from "./decide.ts";

export class PolicyViolation extends Error {
  constructor(
    readonly decisionKey: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyViolation";
  }
}

export type Payable = {
  decision: Decision;
  /** Hash of the signed DECISION receipt. */
  decisionHash: Sha256Ref;
  approval?: ApprovalBody;
};

export type Receiver = { email: string; wallet: "PAYPAL" | "VENMO" };

export type PayRunInput = {
  client: PayPalClient;
  payables: Payable[];
  resolveReceiver: (payeeId: string) => Promise<Receiver>;
  now: Date;
  emailSubject: string;
  /** Sandbox test value for items[0].note, e.g. PAYOUTS_TEST_VALUES.insufficientFundsNote. */
  sandboxTestNote?: string;
};

export type PayRunResult = {
  senderBatchId: string;
  batch: PayoutBatch;
  items: { decisionKey: string; senderItemId: string; payeeId: string; amountMinor: number }[];
};

/** Same decisions in any order give the same batch id, so PayPal rejects a repeated pay run. */
export function payRunBatchId(decisionHashes: readonly Sha256Ref[]): string {
  const sorted = [...decisionHashes].sort();
  return `pr-${toHex(sha256(utf8("a2h-payrun-v1\n"), utf8(canonicalize(sorted)))).slice(0, 40)}`;
}

export function assertPayable(p: Payable, now: Date): number {
  const d = p.decision;
  if (d.status === "BLOCKED") throw new PolicyViolation(d.decisionKey, `blocked by ${d.blockedBy}: ${d.reason}`);
  if (d.status === "ALREADY_PAID") throw new PolicyViolation(d.decisionKey, "already paid");
  if (d.amountMinor === undefined) throw new PolicyViolation(d.decisionKey, "decision has no amount");
  if (d.status === "NEEDS_APPROVAL") {
    const check = checkApproval({ decisionHash: p.decisionHash, decisionKey: d.decisionKey }, p.approval, now);
    if (!check.ok) throw new PolicyViolation(d.decisionKey, check.reason);
  }
  return d.amountMinor;
}

export async function executePayRun(input: PayRunInput): Promise<PayRunResult> {
  if (input.payables.length === 0) throw new Error("nothing to pay");
  const seen = new Set<string>();
  const items: PayRunResult["items"] = [];
  for (const p of input.payables) {
    const amountMinor = assertPayable(p, input.now);
    if (seen.has(p.decision.decisionKey)) throw new PolicyViolation(p.decision.decisionKey, "decision appears twice in one pay run");
    seen.add(p.decision.decisionKey);
    items.push({ decisionKey: p.decision.decisionKey, senderItemId: p.decision.decisionKey, payeeId: p.decision.payeeId, amountMinor });
  }

  const senderBatchId = payRunBatchId(input.payables.map((p) => p.decisionHash));
  const receivers = await Promise.all(items.map((i) => input.resolveReceiver(i.payeeId)));
  const batch = await createPayoutBatch(input.client, {
    senderBatchId,
    emailSubject: input.emailSubject,
    items: items.map((item, index) => {
      const receiver = receivers[index]!;
      const note = index === 0 && input.sandboxTestNote ? input.sandboxTestNote : receiver.wallet === "VENMO" ? "Payment for verified work" : undefined;
      return {
        receiverEmail: receiver.email,
        amountMinor: item.amountMinor,
        currency: "USD" as const,
        senderItemId: item.senderItemId,
        recipientWallet: receiver.wallet,
        ...(note ? { note } : {}),
      };
    }),
  });
  return { senderBatchId, batch, items };
}

export type PayRunStatus = {
  batchStatus: string;
  items: { senderItemId: string; payoutItemId: string; transactionStatus: string }[];
};

/** Reads a batch's item statuses: the fallback when webhooks are not registered or are delayed. */
export async function readPayRun(client: PayPalClient, payoutBatchId: string): Promise<PayRunStatus> {
  const batch = await getPayoutBatch(client, payoutBatchId);
  return {
    batchStatus: batch.batch_header.batch_status,
    items: (batch.items ?? []).map((i) => ({
      senderItemId: i.payout_item.sender_item_id,
      payoutItemId: i.payout_item_id,
      transactionStatus: i.transaction_status ?? "UNKNOWN",
    })),
  };
}
