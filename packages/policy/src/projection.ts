/**
 * Rebuilds the current state from the receipt log. Receipts are the system of record:
 * week-to-date spend, tax totals and "already paid" all come from here, never from a
 * separately updated counter that could drift.
 */
import type { Receipt, Sha256Ref } from "@handoff/trust";
import type { ApprovalBody } from "./approval.ts";
import type { Decision, LedgerFacts } from "./decide.ts";
import type { LaborMandate } from "./mandate.ts";

export type PayoutState = "SUBMITTED" | "SUCCEEDED" | "FAILED" | "UNCLAIMED" | "RETURNED" | "CANCELED" | "BLOCKED" | "HELD" | "REFUNDED";

export type ProjectedPayout = {
  decisionKey: string;
  payeeId: string;
  amountMinor: number;
  payoutSeq: number;
  /** Timestamp of the PAYOUT receipt; tax totals use its calendar year (UTC). */
  submittedAt: string;
  senderBatchId: string;
  state: PayoutState;
  lastEventSeq?: number;
};

export type LedgerView = {
  mandates: Map<string, { mandate: LaborMandate; seq: number; hash: Sha256Ref; revoked: boolean }>;
  tasks: Map<string, { seq: number; mandateId?: string; payeeId: string; rateLineId: string; quantity: number; spec?: string }>;
  deliveries: Map<number, { seq: number; taskId: string }>;
  verdicts: Map<number, { seq: number; deliverySeq: number; taskId: string; pass: boolean; reasons: string[] }>;
  decisions: Map<string, { seq: number; hash: Sha256Ref; decision: Decision }>;
  approvals: Map<string, { seq: number; body: ApprovalBody }>;
  payouts: Map<string, ProjectedPayout>;
};

const EVENT_STATE: Record<string, PayoutState> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "CANCELED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.HELD": "HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
};

/** States where the money did not (or no longer does) reach the payee. */
const RELEASED: ReadonlySet<PayoutState> = new Set(["FAILED", "RETURNED", "CANCELED", "BLOCKED", "REFUNDED"]);

type Body = Record<string, unknown>;

export function project(receipts: readonly Receipt[]): LedgerView {
  const view: LedgerView = {
    mandates: new Map(),
    tasks: new Map(),
    deliveries: new Map(),
    verdicts: new Map(),
    decisions: new Map(),
    approvals: new Map(),
    payouts: new Map(),
  };

  for (const r of receipts) {
    const b = r.body as Body;
    switch (r.type) {
      case "MANDATE": {
        const mandate = b.mandate as LaborMandate;
        view.mandates.set(mandate.mandateId, { mandate, seq: r.seq, hash: r.hash, revoked: false });
        break;
      }
      case "REVOCATION": {
        const m = view.mandates.get(String(b.mandateId));
        if (m) m.revoked = true;
        break;
      }
      case "TASK":
        view.tasks.set(String(b.taskId), {
          seq: r.seq,
          mandateId: b.mandateId === undefined ? undefined : String(b.mandateId),
          payeeId: String(b.payeeId),
          rateLineId: String(b.rateLineId),
          quantity: Number(b.quantity),
          spec: b.spec === undefined ? undefined : String(b.spec),
        });
        break;
      case "DELIVERY":
        view.deliveries.set(r.seq, { seq: r.seq, taskId: String(b.taskId) });
        break;
      case "VERDICT":
        view.verdicts.set(Number(b.deliverySeq), {
          seq: r.seq,
          deliverySeq: Number(b.deliverySeq),
          taskId: String(b.taskId),
          pass: b.pass === true,
          reasons: Array.isArray(b.reasons) ? b.reasons.map(String) : [],
        });
        break;
      case "DECISION": {
        const decision = b as unknown as Decision;
        view.decisions.set(decision.decisionKey, { seq: r.seq, hash: r.hash, decision });
        break;
      }
      case "APPROVAL": {
        const body = b as unknown as ApprovalBody;
        view.approvals.set(body.decisionKey, { seq: r.seq, body });
        break;
      }
      case "PAYOUT":
        for (const item of (b.items as Body[] | undefined) ?? []) {
          const key = String(item.senderItemId);
          view.payouts.set(key, {
            decisionKey: key,
            payeeId: String(item.payeeId),
            amountMinor: Number(item.amountMinor),
            payoutSeq: r.seq,
            submittedAt: r.ts,
            senderBatchId: String(b.senderBatchId),
            state: "SUBMITTED",
          });
        }
        break;
      case "CONFIRMATION":
      case "RETURN": {
        const payout = view.payouts.get(String(b.senderItemId));
        const state = EVENT_STATE[String(b.eventType)];
        if (payout && state) {
          payout.state = state;
          payout.lastEventSeq = r.seq;
        }
        break;
      }
      default:
        break;
    }
  }
  return view;
}

/**
 * Facts the policy engine needs for one decision. Week-to-date counts every amount already
 * committed under the mandate (approved, waiting for approval, or paid) unless the payout
 * was released by a failure, return or cancellation. Year-to-date counts payouts PayPal
 * confirmed as succeeded in that calendar year.
 */
export function factsFor(view: LedgerView, mandateId: string, payeeId: string, year: number): LedgerFacts {
  let weekToDateMinor = 0;
  for (const { decision } of view.decisions.values()) {
    if (decision.mandateId !== mandateId || decision.amountMinor === undefined) continue;
    if (decision.status !== "APPROVED" && decision.status !== "NEEDS_APPROVAL") continue;
    const approval = view.approvals.get(decision.decisionKey);
    if (approval && !approval.body.approved) continue;
    const payout = view.payouts.get(decision.decisionKey);
    if (payout && RELEASED.has(payout.state)) continue;
    weekToDateMinor += decision.amountMinor;
  }

  let payeeYearToDateMinor = 0;
  let payeeYearToDatePayments = 0;
  const paidDecisionKeys = new Set<string>();
  for (const p of view.payouts.values()) {
    if (!RELEASED.has(p.state)) paidDecisionKeys.add(p.decisionKey);
    if (p.payeeId !== payeeId || p.state !== "SUCCEEDED") continue;
    if (new Date(p.submittedAt).getUTCFullYear() !== year) continue;
    payeeYearToDateMinor += p.amountMinor;
    payeeYearToDatePayments += 1;
  }
  return { weekToDateMinor, payeeYearToDateMinor, payeeYearToDatePayments, paidDecisionKeys };
}
