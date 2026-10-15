/**
 * Read-only data for the ledger dashboards (AG Studio), all derived from receipts: each receipt
 * with its Verified or Broken status, budget against each week's cap, tax running totals per
 * payee, and flags worth a person's attention.
 */
import { deterministicFlags, payRunDigest } from "@handoff/agents";
import { K_THRESHOLD_MINOR, K_THRESHOLD_PAYMENTS, NEC_THRESHOLD_MINOR, project } from "@handoff/policy";
import { Keyring, verifyChain, type PublicKeyRecord, type Receipt } from "@handoff/trust";
import { describeReceipt } from "./describe.ts";

const ACTOR_KIND: Record<string, "agent" | "code" | "person"> = {
  "ops-agent": "agent",
  verifier: "agent",
  assistant: "agent",
  explainer: "agent",
  "policy-engine": "code",
  "webhook-handler": "code",
  system: "code",
  creator: "person",
  contractor: "person",
};

const RELEASED = new Set(["FAILED", "RETURNED", "CANCELED", "BLOCKED", "REFUNDED"]);

export type DashboardData = ReturnType<typeof buildDashboard>;

export function buildDashboard(receipts: readonly Receipt[], keys: readonly PublicKeyRecord[], now: Date) {
  const chain = verifyChain(receipts, new Keyring(keys));
  const broken = new Set(chain.failures.map((f) => f.seq));
  const view = project(receipts);
  const year = now.getUTCFullYear();

  const rows = [...receipts].reverse().map((r) => {
    const b = r.body as Record<string, unknown>;
    const amountMinor = r.type === "DECISION" ? (b.amountMinor as number | undefined) ?? null : r.type === "PAYOUT" ? (b.totalMinor as number | undefined) ?? null : null;
    return {
      seq: r.seq,
      type: r.type,
      actor: r.actor,
      actorKind: ACTOR_KIND[r.actor] ?? "code",
      ts: r.ts,
      summary: describeReceipt(r),
      amountMinor,
      status: broken.has(r.seq) ? ("Broken" as const) : ("Verified" as const),
      hash: r.hash,
    };
  });

  const budget = [...view.mandates.values()].reverse().map(({ mandate }) => {
    const decisions = [...view.decisions.values()].filter((d) => d.decision.mandateId === mandate.mandateId).map((d) => d.decision);
    let committedMinor = 0;
    let pendingApprovalMinor = 0;
    let paidMinor = 0;
    let blocked = 0;
    const byRateLine = new Map<string, number>();
    for (const d of decisions) {
      if (d.status === "BLOCKED") {
        blocked++;
        continue;
      }
      if (d.amountMinor === undefined) continue;
      const approval = view.approvals.get(d.decisionKey);
      const payout = view.payouts.get(d.decisionKey);
      if (payout?.state === "SUCCEEDED") paidMinor += d.amountMinor;
      if (payout && RELEASED.has(payout.state)) continue;
      if (d.status === "NEEDS_APPROVAL" && !approval) {
        pendingApprovalMinor += d.amountMinor;
        continue;
      }
      if (approval && !approval.body.approved) continue;
      committedMinor += d.amountMinor;
      byRateLine.set(d.rateLineId, (byRateLine.get(d.rateLineId) ?? 0) + d.amountMinor);
    }
    return {
      mandateId: mandate.mandateId,
      validFrom: mandate.validFrom,
      validUntil: mandate.validUntil,
      weeklyCapMinor: mandate.limits.weeklyCapMinor,
      committedMinor,
      pendingApprovalMinor,
      paidMinor,
      remainingMinor: Math.max(0, mandate.limits.weeklyCapMinor - committedMinor - pendingApprovalMinor),
      blocked,
      byRateLine: [...byRateLine.entries()].map(([rateLineId, minor]) => ({ rateLineId, committedMinor: minor })),
    };
  });

  const latest = [...view.mandates.values()].at(-1)?.mandate;
  const payeeNames = new Map((latest?.payees ?? []).map((p) => [p.id, p.displayName]));
  const tax = new Map<string, { paidMinor: number; payments: number }>();
  for (const id of payeeNames.keys()) tax.set(id, { paidMinor: 0, payments: 0 });
  for (const p of view.payouts.values()) {
    if (p.state !== "SUCCEEDED" || new Date(p.submittedAt).getUTCFullYear() !== year) continue;
    const t = tax.get(p.payeeId) ?? { paidMinor: 0, payments: 0 };
    t.paidMinor += p.amountMinor;
    t.payments += 1;
    tax.set(p.payeeId, t);
  }
  const taxRows = [...tax.entries()].map(([payeeId, t]) => ({
    payeeId,
    name: payeeNames.get(payeeId) ?? payeeId,
    year,
    paidMinor: t.paidMinor,
    payments: t.payments,
    nec: { thresholdMinor: NEC_THRESHOLD_MINOR, percent: Math.min(100, Math.round((t.paidMinor / NEC_THRESHOLD_MINOR) * 1000) / 10), reached: t.paidMinor >= NEC_THRESHOLD_MINOR },
    k: {
      thresholdMinor: K_THRESHOLD_MINOR,
      thresholdPayments: K_THRESHOLD_PAYMENTS,
      reached: t.paidMinor > K_THRESHOLD_MINOR && t.payments > K_THRESHOLD_PAYMENTS,
    },
  }));

  const flags: { kind: string; receiptSeq: number; note: string }[] = [...deterministicFlags(payRunDigest(receipts))];
  for (const { seq, decision } of view.decisions.values()) {
    if (decision.status === "BLOCKED") flags.push({ kind: "policy_block", receiptSeq: seq, note: `${decision.taskId}: ${decision.reason ?? decision.blockedBy}` });
  }
  for (const { seq, body } of view.approvals.values()) {
    if (!body.approved) flags.push({ kind: "declined", receiptSeq: seq, note: `Creator declined ${body.decisionKey.slice(0, 11)}…` });
  }
  for (const p of view.payouts.values()) {
    if (RELEASED.has(p.state)) flags.push({ kind: "payout_released", receiptSeq: p.lastEventSeq ?? p.payoutSeq, note: `Payout to ${p.payeeId} ${p.state.toLowerCase()}` });
  }
  for (const f of chain.failures) flags.push({ kind: "chain_broken", receiptSeq: f.seq, note: `${f.code}: ${f.message}` });
  flags.sort((a, b) => b.receiptSeq - a.receiptSeq);

  return {
    generatedAt: now.toISOString(),
    chain: { ok: chain.ok, checked: chain.checked, firstBrokenSeq: chain.firstBrokenSeq ?? null },
    receipts: rows,
    budget,
    tax: taxRows,
    taxNote: "Running totals only, not a filing decision. Payments through PayPal are generally reported by PayPal on Form 1099-K; some states use lower thresholds.",
    flags,
  };
}
