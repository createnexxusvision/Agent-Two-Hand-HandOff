import type { LanguageModel } from "ai";
import { project } from "@handoff/policy";
import type { Receipt } from "@handoff/trust";
import { promptFor } from "./prompts.ts";
import { structuredCall } from "./run.ts";
import { ExplanationSchema, type Explanation } from "./schemas.ts";
import { looksLikePaymentInstruction, untrusted } from "./untrusted.ts";

const usd = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/**
 * A compact, code-built digest. Amounts come from receipts; the model never computes them.
 * With a mandate id, only that week's decisions, payouts and delivery notes are included.
 */
export function payRunDigest(receipts: readonly Receipt[], mandateId?: string) {
  const view = project(receipts);
  const inScope = (id?: string) => mandateId === undefined || id === mandateId;
  const decisions = [...view.decisions.values()].filter(({ decision: d }) => inScope(d.mandateId)).map(({ seq, decision: d }) => ({
    receiptSeq: seq,
    taskId: d.taskId,
    payeeId: d.payeeId,
    status: d.status,
    amount: d.amountMinor === undefined ? null : usd(d.amountMinor),
    blockedBy: d.blockedBy ?? null,
  }));
  const scoped = [...view.payouts.values()].filter((p) => inScope(view.decisions.get(p.decisionKey)?.decision.mandateId));
  const payouts = scoped.map((p) => ({ payeeId: p.payeeId, amount: usd(p.amountMinor), state: p.state }));
  const totalPaid = scoped.filter((p) => p.state !== "FAILED" && p.state !== "RETURNED").reduce((s, p) => s + p.amountMinor, 0);
  const notes = receipts
    .filter((r) => r.type === "DELIVERY" && inScope(r.body.mandateId as string | undefined) && typeof (r.body.note as { text?: unknown } | undefined)?.text === "string")
    .map((r) => ({ receiptSeq: r.seq, text: String((r.body.note as { text: string }).text) }));
  return { decisions, payouts, totalPaid: usd(totalPaid), notes };
}

/** Flags code can raise without a model. */
export function deterministicFlags(digest: ReturnType<typeof payRunDigest>): Explanation["flags"] {
  return digest.notes
    .filter((n) => looksLikePaymentInstruction(n.text))
    .map((n) => ({ kind: "payment_instruction_in_text" as const, receiptSeq: n.receiptSeq, note: "Delivery note contains payment instructions; ignored by the policy engine." }));
}

/** What plain code can say about a pay run when no model is available. */
export function plainSummary(digest: ReturnType<typeof payRunDigest>): string {
  const count = (status: string) => digest.decisions.filter((d) => d.status === status).length;
  const waiting = digest.decisions.filter((d) => d.status === "NEEDS_APPROVAL");
  const parts = [`${digest.decisions.length} tasks were decided: ${count("APPROVED")} approved, ${waiting.length} waiting for the creator, ${count("BLOCKED")} blocked.`];
  parts.push(`${digest.payouts.length} payouts went to PayPal, ${digest.totalPaid} in total.`);
  const reasons = [...new Set(digest.decisions.filter((d) => d.blockedBy).map((d) => d.blockedBy))];
  if (reasons.length) parts.push(`Blocked by: ${reasons.join(", ")}.`);
  if (waiting.length) parts.push(`Waiting for approval: ${waiting.map((d) => `${d.amount} for ${d.payeeId}`).join(", ")}.`);
  return parts.join(" ");
}

export async function explainPayRun(input: { model: LanguageModel; modelId: string; receipts: readonly Receipt[]; mandateId?: string }) {
  const prompt = promptFor("explainer");
  const digest = payRunDigest(input.receipts, input.mandateId);
  const { notes, ...facts } = digest;
  const explanation = await structuredCall({
    agent: "explainer",
    model: input.model,
    system: prompt.text,
    prompt: [
      `Pay-run digest (trusted):\n${JSON.stringify(facts, null, 2)}`,
      ...notes.map((n) => `Delivery note on receipt #${n.receiptSeq}:\n${untrusted("delivery_note", n.text)}`),
    ].join("\n\n"),
    schema: ExplanationSchema,
    name: "pay_run_explanation",
  });
  const flags = [...deterministicFlags(digest)];
  for (const f of explanation.flags) {
    if (!flags.some((x) => x.kind === f.kind && x.receiptSeq === f.receiptSeq)) flags.push(f);
  }
  return { summary: explanation.summary, flags, modelId: input.modelId, promptVersion: prompt.version };
}
