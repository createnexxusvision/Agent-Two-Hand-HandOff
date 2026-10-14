/**
 * The payment decision. Pure: no I/O, no clock reads, no model calls.
 *
 * There is deliberately no amount anywhere in the input except the signed rate card.
 * Agents reference a rate line and a quantity; this function computes the amount.
 */
import { domainHash, type Sha256Ref } from "@handoff/trust";
import { findPayee, findRateLine, mandateHash, validateMandate, type LaborMandate } from "./mandate.ts";

export const POLICY_VERSION = "policy-2026.10.0";

/** IRS: 1099-NEC/MISC threshold for payments made after Dec 31, 2025 (OBBBA §70433). */
export const NEC_THRESHOLD_MINOR = 200_000;
/** IRS: Form 1099-K reporting threshold, more than $20,000 and more than 200 transactions. */
export const K_THRESHOLD_MINOR = 2_000_000;
export const K_THRESHOLD_PAYMENTS = 200;

export const CHECK_ORDER = [
  "not_already_paid",
  "mandate_valid",
  "payee_listed",
  "payee_cleared",
  "tax_form",
  "verdict_pass",
  "rate_line",
  "weekly_cap",
  "approval_threshold",
] as const;
export type CheckId = (typeof CHECK_ORDER)[number];

export type CheckResult = { id: CheckId; status: "pass" | "fail" | "skipped"; detail: string };

export type TaskRef = { taskId: string; payeeId: string; rateLineId: string; quantity: number };
export type VerdictRef = { seq: number; pass: boolean; reasons: string[] };
export type PayeeStatus = {
  screening: { result: "clear" | "review" | "match"; listSha256: Sha256Ref; matchedEntryId?: string };
  taxForm: "W-9" | "W-8BEN" | "none";
};
export type LedgerFacts = {
  /** Paid plus reserved (approved or awaiting approval) amounts this week, excluding this task. */
  weekToDateMinor: number;
  payeeYearToDateMinor: number;
  payeeYearToDatePayments: number;
  paidDecisionKeys: ReadonlySet<string>;
};

export type DecideInput = {
  mandate: LaborMandate;
  mandateSignatureValid: boolean;
  mandateRevoked: boolean;
  task: TaskRef;
  deliverySeq: number;
  verdict: VerdictRef;
  payee: PayeeStatus;
  facts: LedgerFacts;
  now: Date;
};

export type TaxMeters = {
  nec: { yearToDateMinor: number; thresholdMinor: number; reached: boolean };
  k: { yearToDateMinor: number; payments: number; thresholdMinor: number; thresholdPayments: number; reached: boolean };
  /** Running totals only. Payments through PayPal are generally reported on 1099-K, not 1099-NEC. */
  note: string;
};

export type Decision = {
  status: "APPROVED" | "NEEDS_APPROVAL" | "BLOCKED" | "ALREADY_PAID";
  decisionKey: string;
  mandateId: string;
  mandateHash: Sha256Ref;
  taskId: string;
  payeeId: string;
  rateLineId: string;
  quantity: number;
  deliverySeq: number;
  verdictSeq: number;
  amountMinor?: number;
  currency: "USD";
  checks: CheckResult[];
  blockedBy?: CheckId;
  reason?: string;
  taxMeters?: TaxMeters;
  policyVersion: string;
};

/** Stable per delivery: the same delivery and verdict can never be paid twice, whatever else changes. */
export function decisionKey(mandateId: string, taskId: string, deliverySeq: number, verdictSeq: number): string {
  const h = domainHash("a2h-decision-key-v1", { mandateId, taskId, deliverySeq, verdictSeq });
  return `dk-${h.slice("sha256:".length, "sha256:".length + 32)}`;
}

const usd = (minor: number) => `$${(minor / 100).toFixed(2)}`;

export function decide(input: DecideInput): Decision {
  const { mandate, task, verdict, payee, facts, now } = input;
  // Read only the fields a TaskRef defines; anything else an agent attached is ignored.
  const taskId = String(task.taskId);
  const payeeId = String(task.payeeId);
  const rateLineId = String(task.rateLineId);
  const quantity = Number(task.quantity);

  const key = decisionKey(mandate.mandateId, taskId, input.deliverySeq, verdict.seq);
  const checks: CheckResult[] = [];

  const base = {
    decisionKey: key,
    mandateId: mandate.mandateId,
    mandateHash: mandateHash(mandate),
    taskId,
    payeeId,
    rateLineId,
    quantity,
    deliverySeq: input.deliverySeq,
    verdictSeq: verdict.seq,
    currency: "USD" as const,
    policyVersion: POLICY_VERSION,
  };

  const finish = (status: Decision["status"], failed?: CheckResult, amountMinor?: number): Decision => {
    for (const id of CHECK_ORDER) {
      if (!checks.some((c) => c.id === id)) checks.push({ id, status: "skipped", detail: "not run after an earlier result" });
    }
    const decision: Decision = { ...base, status, checks };
    if (failed) {
      decision.blockedBy = failed.id;
      decision.reason = failed.detail;
    }
    if (amountMinor !== undefined && status !== "BLOCKED") {
      decision.amountMinor = amountMinor;
      decision.taxMeters = taxMeters(facts, amountMinor);
    }
    return decision;
  };
  const pass = (id: CheckId, detail: string) => void checks.push({ id, status: "pass", detail });
  const fail = (id: CheckId, detail: string) => {
    const c: CheckResult = { id, status: "fail", detail };
    checks.push(c);
    return finish("BLOCKED", c);
  };

  if (facts.paidDecisionKeys.has(key)) {
    checks.push({ id: "not_already_paid", status: "fail", detail: "a payout already exists for this delivery" });
    return finish("ALREADY_PAID");
  }
  pass("not_already_paid", "no payout exists for this delivery");

  const problems = validateMandate(mandate);
  const nowMs = now.getTime();
  if (!input.mandateSignatureValid) return fail("mandate_valid", "the creator's mandate signature does not verify");
  if (input.mandateRevoked) return fail("mandate_valid", "the creator revoked this mandate");
  if (problems.length) return fail("mandate_valid", `mandate is malformed: ${problems.join("; ")}`);
  if (nowMs < Date.parse(mandate.validFrom) || nowMs >= Date.parse(mandate.validUntil)) {
    return fail("mandate_valid", `outside the mandate window ${mandate.validFrom} – ${mandate.validUntil}`);
  }
  pass("mandate_valid", `signature valid, inside ${mandate.validFrom.slice(0, 10)} – ${mandate.validUntil.slice(0, 10)}`);

  const listed = findPayee(mandate, payeeId);
  if (!listed) return fail("payee_listed", `${payeeId} is not on the mandate's payee list`);
  pass("payee_listed", `${listed.displayName} is on the payee list`);

  const s = payee.screening;
  if (s.result === "match") return fail("payee_cleared", `screening match (${s.matchedEntryId}); payout blocked`);
  if (s.result === "review") return fail("payee_cleared", `possible screening match (${s.matchedEntryId}); a person must review it`);
  pass("payee_cleared", `no match against list ${s.listSha256.slice(0, 18)}…`);

  if (payee.taxForm === "none") {
    return fail(
      "tax_form",
      "no W-9 or W-8BEN on file. Collect one before the first payment: without a TIN, 24% backup withholding applies and this app cannot withhold.",
    );
  }
  pass("tax_form", `${payee.taxForm} on file`);

  if (!verdict.pass) {
    const why = verdict.reasons.length ? verdict.reasons.join("; ") : "no reason given";
    return fail("verdict_pass", `verifier verdict #${verdict.seq} failed: ${why}`);
  }
  pass("verdict_pass", `verifier verdict #${verdict.seq} passed`);

  const line = findRateLine(mandate, rateLineId);
  if (!line) return fail("rate_line", `rate line ${rateLineId} is not in the mandate`);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > line.maxQuantity) {
    return fail("rate_line", `quantity ${quantity} is outside 1–${line.maxQuantity} for ${line.id}`);
  }
  const amountMinor = line.amountMinor * quantity;
  if (!Number.isSafeInteger(amountMinor)) return fail("rate_line", "amount overflow");
  pass("rate_line", `${line.id} × ${quantity} = ${usd(amountMinor)} (from the signed rate card)`);

  const weekAfter = facts.weekToDateMinor + amountMinor;
  if (weekAfter > mandate.limits.weeklyCapMinor) {
    return fail("weekly_cap", `${usd(facts.weekToDateMinor)} + ${usd(amountMinor)} would exceed the ${usd(mandate.limits.weeklyCapMinor)} weekly cap`);
  }
  pass("weekly_cap", `week to date ${usd(facts.weekToDateMinor)} + ${usd(amountMinor)} = ${usd(weekAfter)} of ${usd(mandate.limits.weeklyCapMinor)}`);

  const needsApproval = amountMinor > mandate.limits.approvalOverMinor;
  pass(
    "approval_threshold",
    needsApproval
      ? `${usd(amountMinor)} is over ${usd(mandate.limits.approvalOverMinor)}: the creator must approve`
      : `${usd(amountMinor)} is within ${usd(mandate.limits.approvalOverMinor)}: no approval needed`,
  );

  return finish(needsApproval ? "NEEDS_APPROVAL" : "APPROVED", undefined, amountMinor);
}

function taxMeters(facts: LedgerFacts, amountMinor: number): TaxMeters {
  const ytd = facts.payeeYearToDateMinor + amountMinor;
  const payments = facts.payeeYearToDatePayments + 1;
  return {
    nec: { yearToDateMinor: ytd, thresholdMinor: NEC_THRESHOLD_MINOR, reached: ytd >= NEC_THRESHOLD_MINOR },
    k: {
      yearToDateMinor: ytd,
      payments,
      thresholdMinor: K_THRESHOLD_MINOR,
      thresholdPayments: K_THRESHOLD_PAYMENTS,
      reached: ytd > K_THRESHOLD_MINOR && payments > K_THRESHOLD_PAYMENTS,
    },
    note: "Running totals only, not a filing decision. Payments through PayPal are generally reported by PayPal on Form 1099-K; some states use lower thresholds.",
  };
}
