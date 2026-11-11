/**
 * pnpm load:business
 *
 * A small-business week through the real engine and the real PayPal sandbox: one signed mandate
 * with a ten-line rate card and eight payees, about thirty tasks of mixed sizes, every payout
 * through the policy engine. It runs in this process on an embedded database (the live site's
 * ledger is untouched), with the webhook id unset so PayPal is polled directly.
 *
 * Expect some work to fail on purpose: the second short carries an injected payment instruction,
 * the third is delivered in the wrong aspect ratio, and the weekly cap ($2,000) is smaller than
 * the work planned, so the last tasks must be blocked. Money is sandbox money.
 */
import { writeFileSync } from "node:fs";
import { demoMandate, payeeRef } from "../../packages/policy/src/demo-studio.ts";
import { mandateHash, project, type LaborMandate } from "../../packages/policy/src/index.ts";
import { domainHash, type Json } from "../../packages/trust/src/index.ts";
import { bootEngine } from "../../packages/engine/src/index.ts";
import { scriptedPlan } from "../../packages/engine/src/simulate.ts";

try {
  process.loadEnvFile();
} catch {
  // No .env file; use the environment as is.
}
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "", PAYPAL_WEBHOOK_ID: "" };
if (!env.PAYPAL_CLIENT_ID || !env.GATE_PAYEE_EMAIL_1 || !env.GATE_PAYEE_EMAIL_2) {
  console.log("Load run: PENDING. Needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and both GATE_PAYEE_EMAIL values.");
  process.exit(2);
}
const usd = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Json;

// --- The business -------------------------------------------------------------------
const RATE_CARD = [
  { id: "caption-v1", description: "Captions", unit: "video", amountMinor: 1500, maxQuantity: 10 },
  { id: "translation-v1", description: "Subtitle translation", unit: "video", amountMinor: 3250, maxQuantity: 8 },
  { id: "short-edit-v1", description: "Short video edit", unit: "short", amountMinor: 4000, maxQuantity: 6 },
  { id: "voiceover-v1", description: "Voiceover", unit: "minute", amountMinor: 6500, maxQuantity: 6 },
  { id: "social-pack-v1", description: "Social media pack", unit: "pack", amountMinor: 8500, maxQuantity: 4 },
  { id: "podcast-edit-v1", description: "Podcast episode edit", unit: "episode", amountMinor: 12000, maxQuantity: 2 },
  { id: "thumb-pack-v1", description: "Thumbnail pack", unit: "pack", amountMinor: 15000, maxQuantity: 2 },
  { id: "long-edit-v1", description: "Long-form video edit", unit: "video", amountMinor: 21000, maxQuantity: 2 },
  { id: "logo-v1", description: "Logo design", unit: "logo", amountMinor: 27500, maxQuantity: 1 },
  { id: "brand-kit-v1", description: "Brand kit", unit: "kit", amountMinor: 42000, maxQuantity: 1 },
] as const;
const WEEKLY_CAP_MINOR = 250_000;
const APPROVAL_OVER_MINOR = 25_000;

const PAYEES = [
  ["theo", "Theo R."], ["ana", "Ana P."], ["sam", "Sam K."], ["ivy", "Ivy N."],
  ["noor", "Noor A."], ["kai", "Kai M."], ["leo", "Leo D."], ["mira", "Mira S."],
] as const;

// [payee, rate line, quantity]. Order matters: the 2nd and 3rd shorts are the deliberate flaws.
const WORK: [string, string, number][] = [
  ["theo", "short-edit-v1", 1], ["ana", "thumb-pack-v1", 1], ["sam", "caption-v1", 3], ["ivy", "voiceover-v1", 2],
  ["theo", "short-edit-v1", 1], ["noor", "podcast-edit-v1", 1], ["kai", "social-pack-v1", 1], ["leo", "translation-v1", 2],
  ["theo", "short-edit-v1", 1], ["mira", "logo-v1", 1], ["ana", "caption-v1", 3], ["ivy", "translation-v1", 1],
  ["sam", "translation-v1", 2], ["noor", "voiceover-v1", 2], ["kai", "caption-v1", 2], ["leo", "short-edit-v1", 1],
  ["mira", "social-pack-v1", 1], ["theo", "caption-v1", 3], ["ana", "voiceover-v1", 1], ["sam", "social-pack-v1", 1],
  ["ivy", "long-edit-v1", 1], ["noor", "caption-v1", 1], ["kai", "voiceover-v1", 1], ["leo", "podcast-edit-v1", 1],
  ["mira", "translation-v1", 1], ["ana", "social-pack-v1", 1], ["theo", "thumb-pack-v1", 1], ["sam", "short-edit-v1", 1],
];

const planned = WORK.reduce((sum, [, line, q]) => sum + RATE_CARD.find((l) => l.id === line)!.amountMinor * q, 0);
const maxPlanned = Number(env.LOAD_MAX_PLANNED_USD ?? 3000) * 100;
if (planned > maxPlanned) {
  console.log(`Planned work is ${usd(planned)}, above the ${usd(maxPlanned)} guard (LOAD_MAX_PLANNED_USD). Not running.`);
  process.exit(2);
}

// --- Run ----------------------------------------------------------------------------
const { engine, info } = await bootEngine(env);
if (!info.paypal) throw new Error("PayPal sandbox client is not configured");
const store = engine.config.store;
const signers = engine.config.signers;
const append = (type: string, actor: string, body: Record<string, Json>, signer: unknown) =>
  (engine as unknown as { append: (t: string, a: string, b: Record<string, Json>, s: unknown) => Promise<{ seq: number }> }).append(type, actor, body, signer);

// Eight payees on the two sandbox receivers: the money lands in two real sandbox accounts.
const emails = [env.GATE_PAYEE_EMAIL_1!, env.GATE_PAYEE_EMAIL_2!];
await store.addKeys(signers.publicKeys(PAYEES.map(([id]) => id)));
for (const [i, [id]] of PAYEES.entries()) await store.putPayeeAddress(id, emails[i % 2]!, engine.config.masterKey);

const day = new Date().toISOString().slice(0, 10);
const validFrom = `${day}T00:00:00.000Z`;
const validUntil = new Date(Date.parse(validFrom) + 7 * 86_400_000).toISOString();
const terms =
  `Maya's studio at small-business scale. ${PAYEES.length} payees. ` +
  RATE_CARD.map((l) => `${l.description} ${usd(l.amountMinor)} per ${l.unit}`).join("; ") +
  `. At most ${usd(WEEKLY_CAP_MINOR)} per week. Anything over ${usd(APPROVAL_OVER_MINOR)} needs my approval. Pay only for verified work.`;
const base = demoMandate({ mandateId: `m-maya-${day.replaceAll("-", "")}-load`, validFrom, validUntil });
const mandate: LaborMandate = {
  ...base,
  intentSummary: "Run the studio's week: edits, captions, voiceover and design. Pay only for verified work.",
  payees: PAYEES.map(([id, displayName], i) => ({ id, displayName, payeeRef: payeeRef(emails[i % 2]!), kind: "individual" as const, rail: "PAYPAL" as const })),
  rateCard: RATE_CARD.map((l) => ({ ...l, currency: "USD" as const })),
  limits: { currency: "USD", weeklyCapMinor: WEEKLY_CAP_MINOR, approvalOverMinor: APPROVAL_OVER_MINOR },
  presentedTermsHash: domainHash("a2h-presented-terms-v1", terms),
};
const t0 = Date.now();
const lap = (label: string, since: number) => console.log(`  ${label}: ${((Date.now() - since) / 1000).toFixed(1)} s`);

console.log(`Mandate ${mandate.mandateId}: cap ${usd(WEEKLY_CAP_MINOR)}, approval over ${usd(APPROVAL_OVER_MINOR)}, ${WORK.length} tasks worth ${usd(planned)}`);
await append("MANDATE", "creator", { mandate: json(mandate), mandateHash: mandateHash(mandate) }, signers.creator);

let t = Date.now();
const tag = "load";
const due = new Date(Date.parse(validUntil) - 86_400_000).toISOString().slice(0, 10);
const specs = scriptedPlan(due);
const SHORT = specs[0]!.spec;
const OTHER = specs[3]!.spec;
const taskIds: string[] = [];
for (const [i, [payeeId, rateLineId, quantity]] of WORK.entries()) {
  const taskId = `T-${tag}-${i + 1}`;
  taskIds.push(taskId);
  await append(
    "TASK",
    "ops-agent",
    { taskId, mandateId: mandate.mandateId, payeeId, rateLineId, quantity, due, spec: json(rateLineId === "short-edit-v1" ? SHORT : OTHER), aiDisclosure: true, planner: "scripted" },
    signers.ops,
  );
}
lap(`planned ${taskIds.length} tasks`, t);

t = Date.now();
let failedWork = 0;
for (const id of taskIds) if (!(await engine.deliverAndVerify(mandate.mandateId, id, "measured")).pass) failedWork++;
lap(`delivered and verified (${failedWork} failed verification)`, t);

t = Date.now();
await engine.decidePending();
let view = project((await engine.view()).receipts);
const mine = [...view.decisions.values()].filter((d) => d.decision.mandateId === mandate.mandateId);
const by = (s: string) => mine.filter((d) => d.decision.status === s).length;
lap(`decided ${mine.length}: ${by("APPROVED")} approved, ${by("NEEDS_APPROVAL")} need Maya, ${by("BLOCKED")} blocked`, t);

// Maya answers every approval: she declines the first one and approves the rest.
t = Date.now();
const waiting = mine.filter((d) => d.decision.status === "NEEDS_APPROVAL");
for (const [i, d] of waiting.entries()) await engine.approve(d.decision.decisionKey, i !== 0);
lap(`Maya answered ${waiting.length} approvals (1 declined)`, t);

t = Date.now();
const settled = await engine.settle({ maxMs: 8 * 60_000, everyMs: 5_000 });
lap(`paid and settled (${settled.paid} sent to PayPal, ${settled.recorded} confirmations, ${settled.pending} still pending)`, t);

// --- Results ------------------------------------------------------------------------
const { receipts } = await engine.view();
view = project(receipts);
const report = await engine.report();
const payouts = [...view.payouts.values()];
const succeeded = payouts.filter((p) => p.state === "SUCCEEDED");
const byState = Object.entries(payouts.reduce<Record<string, number>>((m, p) => ({ ...m, [p.state]: (m[p.state] ?? 0) + 1 }), {}));
const perPayee = new Map<string, [number, number]>();
for (const p of succeeded) perPayee.set(p.payeeId, [(perPayee.get(p.payeeId)?.[0] ?? 0) + p.amountMinor, (perPayee.get(p.payeeId)?.[1] ?? 0) + 1]);
const blocked = mine.filter((d) => d.decision.status === "BLOCKED");
const blockedBy = blocked.reduce<Record<string, number>>((m, d) => ({ ...m, [d.decision.blockedBy ?? "?"]: (m[d.decision.blockedBy ?? "?"] ?? 0) + 1 }), {});
const amounts = [...new Set(succeeded.map((p) => p.amountMinor))].sort((a, b) => a - b);
const paidTotal = succeeded.reduce((s, p) => s + p.amountMinor, 0);

console.log("\nResults");
console.log(`  payouts sent: ${payouts.length}  states: ${byState.map(([s, n]) => `${s} ${n}`).join(", ")}`);
console.log(`  paid (PayPal-confirmed): ${usd(paidTotal)} of ${usd(WEEKLY_CAP_MINOR)} cap; ${amounts.length} distinct amounts from ${usd(amounts[0] ?? 0)} to ${usd(amounts.at(-1) ?? 0)}`);
console.log(`  blocked ${blocked.length}: ${Object.entries(blockedBy).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
console.log(`  per payee: ${[...perPayee.entries()].map(([id, [m, n]]) => `${id} ${usd(m)} (${n})`).join(", ")}`);
console.log(`  receipts: ${receipts.length}; ledger verifies: ${report.ok}; chain checked ${report.chain.checked}; checkpoints ${report.checkpoints.length}`);
console.log(`  total time: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const out = env.LOAD_LEDGER_OUT;
if (out) {
  writeFileSync(out, JSON.stringify(await store.exportLedger(), null, 2));
  console.log(`  ledger written for offline check: ${out}`);
}
const ok = report.ok && settled.pending === 0 && payouts.every((p) => p.state === "SUCCEEDED") && paidTotal <= WEEKLY_CAP_MINOR;
console.log(ok ? "\nLoad run: PASS" : "\nLoad run: NEEDS A LOOK");
process.exitCode = ok ? 0 : 1;
