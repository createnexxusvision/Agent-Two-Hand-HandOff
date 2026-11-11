/**
 * The ledger as related tables for AG Studio: receipts, tasks, payouts, payees, weekly mandates
 * and flags. Every row is derived from the signed receipts, so the dashboards can never disagree
 * with the chain. Money is in dollars (Studio formats it); the receipts keep integer cents.
 */
import { K_THRESHOLD_MINOR, K_THRESHOLD_PAYMENTS, NEC_THRESHOLD_MINOR, project, type LaborMandate } from "@handoff/policy";
import { Keyring, verifyChain, type PublicKeyRecord, type Receipt } from "@handoff/trust";
import { buildDashboard } from "./dashboard.ts";
import { describeReceipt } from "./describe.ts";

const ACTOR_KIND: Record<string, "AI agent" | "Plain code" | "Person"> = {
  "ops-agent": "AI agent",
  verifier: "AI agent",
  assistant: "AI agent",
  explainer: "AI agent",
  "policy-engine": "Plain code",
  "webhook-handler": "Plain code",
  system: "Plain code",
  creator: "Person",
  contractor: "Person",
};

/** Where a task stands, in the order money moves. */
export const TASK_STAGES = [
  "Planned",
  "Delivered",
  "Failed verification",
  "Verified",
  "Blocked",
  "Declined",
  "Waiting for approval",
  "Approved",
  "Sent to PayPal",
  "Paid",
  "Payout returned",
] as const;
export type TaskStage = (typeof TASK_STAGES)[number];

const RELEASED = new Set(["FAILED", "RETURNED", "CANCELED", "BLOCKED", "REFUNDED"]);
const dollars = (minor: number) => Math.round(minor) / 100;

export type LedgerTables = ReturnType<typeof buildLedgerTables>;

export function buildLedgerTables(receipts: readonly Receipt[], keys: readonly PublicKeyRecord[], now: Date) {
  const chain = verifyChain(receipts, new Keyring(keys));
  const broken = new Set(chain.failures.map((f) => f.seq));
  const view = project(receipts);
  const dash = buildDashboard(receipts, keys, now);
  const year = now.getUTCFullYear();

  const mandateOf = new Map<string, LaborMandate>([...view.mandates.values()].map(({ mandate }) => [mandate.mandateId, mandate]));
  const latest = [...view.mandates.values()].at(-1)?.mandate;
  const payeeName = new Map<string, string>();
  for (const m of mandateOf.values()) for (const p of m.payees) payeeName.set(p.id, p.displayName);

  // Latest delivery, verdict and decision per task (a task can be redelivered).
  const deliveredAt = new Map<string, string>();
  const verdictOf = new Map<string, { pass: boolean; reason: string }>();
  const decisionOf = new Map<string, NonNullable<ReturnType<typeof view.decisions.get>>>();
  const tsOf = new Map(receipts.map((r) => [r.seq, r.ts]));
  for (const d of view.deliveries.values()) deliveredAt.set(d.taskId, tsOf.get(d.seq) ?? "");
  for (const v of view.verdicts.values()) verdictOf.set(v.taskId, { pass: v.pass, reason: v.reasons[0] ?? "" });
  for (const d of view.decisions.values()) {
    const prev = decisionOf.get(d.decision.taskId);
    if (!prev || prev.seq < d.seq) decisionOf.set(d.decision.taskId, d);
  }

  const tasks = [...view.tasks.entries()].map(([taskId, t]) => {
    const mandate = t.mandateId ? mandateOf.get(t.mandateId) : undefined;
    const line = mandate?.rateCard.find((l) => l.id === t.rateLineId);
    const decided = decisionOf.get(taskId);
    const decision = decided?.decision;
    const approval = decision ? view.approvals.get(decision.decisionKey) : undefined;
    const payout = decision ? view.payouts.get(decision.decisionKey) : undefined;
    const verdict = verdictOf.get(taskId);
    const amountMinor = decision?.amountMinor ?? (line ? line.amountMinor * t.quantity : 0);

    let stage: TaskStage = "Planned";
    if (payout?.state === "SUCCEEDED") stage = "Paid";
    else if (payout && RELEASED.has(payout.state)) stage = "Payout returned";
    else if (payout) stage = "Sent to PayPal";
    else if (decision?.status === "BLOCKED") stage = "Blocked";
    else if (approval && !approval.body.approved) stage = "Declined";
    else if (decision?.status === "NEEDS_APPROVAL" && !approval) stage = "Waiting for approval";
    else if (decision) stage = "Approved";
    else if (verdict) stage = verdict.pass ? "Verified" : "Failed verification";
    else if (deliveredAt.has(taskId)) stage = "Delivered";

    const plannedAt = tsOf.get(t.seq) ?? "";
    return {
      id: taskId,
      mandateId: t.mandateId ?? null,
      payeeId: t.payeeId,
      rateLine: line?.description ?? t.rateLineId,
      quantity: t.quantity,
      amount: dollars(amountMinor),
      stage,
      stageOrder: TASK_STAGES.indexOf(stage),
      verdict: verdict ? (verdict.pass ? "Pass" : "Fail") : null,
      decision: decision?.status ?? null,
      blockedBy: decision?.blockedBy ?? null,
      reason: decision?.reason ?? (verdict && !verdict.pass ? verdict.reason : null),
      plannedAt,
      plannedDay: plannedAt.slice(0, 10),
      paidAmount: stage === "Paid" ? dollars(amountMinor) : 0,
      pendingAmount: stage === "Waiting for approval" ? dollars(amountMinor) : 0,
      inFlightAmount: stage === "Approved" || stage === "Sent to PayPal" ? dollars(amountMinor) : 0,
      blockedAmount: stage === "Blocked" || stage === "Failed verification" || stage === "Declined" ? dollars(amountMinor) : 0,
      isBlocked: stage === "Blocked" ? 1 : 0,
    };
  });

  const taskOfDecision = new Map([...view.decisions.values()].map(({ decision }) => [decision.decisionKey, decision.taskId]));
  const payouts = [...view.payouts.values()].map((p) => ({
    id: p.decisionKey.slice(0, 16),
    taskId: taskOfDecision.get(p.decisionKey) ?? null,
    amount: dollars(p.amountMinor),
    state: p.state,
    sentAt: p.submittedAt,
    sentDay: p.submittedAt.slice(0, 10),
    batch: p.senderBatchId,
    receiptSeq: p.lastEventSeq ?? p.payoutSeq,
  }));

  const invoices = [...view.invoices.values()].map((i) => ({
    id: i.invoiceNumber || i.invoiceId,
    brand: i.brand,
    description: i.description,
    amount: dollars(i.amountMinor),
    status: i.paidSeq === undefined ? "Awaiting payment" : "Paid",
    issuedAt: i.issuedAt,
    issuedDay: i.issuedAt.slice(0, 10),
    paidAt: i.paidAt ?? null,
    paidAmount: i.paidMinor === undefined ? 0 : dollars(i.paidMinor),
    outstandingAmount: i.paidSeq === undefined ? dollars(i.amountMinor) : 0,
    receiptSeq: i.paidSeq ?? i.issuedSeq,
  }));

  const rows = receipts.map((r) => {
    const b = r.body as Record<string, unknown>;
    const mandateId = typeof b.mandateId === "string" ? b.mandateId : r.type === "MANDATE" ? (b.mandate as LaborMandate).mandateId : null;
    const amountMinor = r.type === "DECISION" ? (b.amountMinor as number | undefined) : r.type === "PAYOUT" ? (b.totalMinor as number | undefined) : undefined;
    return {
      seq: r.seq,
      type: r.type,
      actor: r.actor,
      actorKind: ACTOR_KIND[r.actor] ?? "Plain code",
      at: r.ts,
      day: r.ts.slice(0, 10),
      summary: describeReceipt(r),
      amount: amountMinor === undefined ? null : dollars(amountMinor),
      status: broken.has(r.seq) ? "Broken" : "Verified",
      hash: r.hash.replace(/^sha-?256:/, "").slice(0, 12),
      taskId: typeof b.taskId === "string" ? b.taskId : null,
      mandateId,
    };
  });

  const payees = dash.tax.map((t) => ({
    id: t.payeeId,
    name: payeeName.get(t.payeeId) ?? t.name,
    year,
    paidYtd: dollars(t.paidMinor),
    payments: t.payments,
    necThreshold: dollars(NEC_THRESHOLD_MINOR),
    necProgress: Math.min(1, t.paidMinor / NEC_THRESHOLD_MINOR),
    kThreshold: dollars(K_THRESHOLD_MINOR),
    kPaymentsThreshold: K_THRESHOLD_PAYMENTS,
    kProgress: Math.min(1, t.paidMinor / K_THRESHOLD_MINOR, t.payments / K_THRESHOLD_PAYMENTS),
  }));

  const mandates = dash.budget.map((b) => ({
    id: b.mandateId,
    week: `Week of ${new Date(b.validFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
    validFrom: b.validFrom.slice(0, 10),
    cap: dollars(b.weeklyCapMinor),
    paid: dollars(b.paidMinor),
    committedUnpaid: dollars(Math.max(0, b.committedMinor - b.paidMinor)),
    pendingApproval: dollars(b.pendingApprovalMinor),
    used: dollars(b.committedMinor + b.pendingApprovalMinor),
    remaining: dollars(b.remainingMinor),
    blocked: b.blocked,
    isActive: b.mandateId === latest?.mandateId ? 1 : 0,
  }));

  const flags = dash.flags.map((f, i) => ({ id: `${f.receiptSeq}-${i}`, receiptSeq: f.receiptSeq, kind: f.kind.replaceAll("_", " "), note: f.note }));

  return {
    asOf: now.toISOString(),
    chain: { ok: chain.ok, checked: chain.checked, firstBrokenSeq: chain.firstBrokenSeq ?? null },
    taxNote: dash.taxNote,
    tables: { receipts: rows, tasks, payouts, payees, mandates, flags, invoices },
  };
}
