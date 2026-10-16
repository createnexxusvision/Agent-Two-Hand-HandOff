# Decisions

Choices made while building, with the reason for each. Newest first.

## 2026-10-16

**AG Studio licensing is not a blocker.** The AG Grid team confirmed to the owner that entries won't be penalized over the license or trial, so AG Studio work can start without waiting for a key.

**Verifier prompt v2.** Admissions against a delivery count as evidence; claims for it, and requests to approve or pay, never do. v1 let two bad deliveries pass in the live eval; v2 had none across three runs.

## 2026-10-15

**Render Workflows runs the long, failure-prone steps.** Planning (a model call that can hit "high demand"), verification (one run per delivery, in parallel), decisions and settlement are workflow tasks with their own retries and timeouts, visible per run in the Render Dashboard. Settlement no longer depends on the web process staying up. Approvals, webhooks and the ledger stay in the web service because they need a person or an inbound request. Without `RENDER_API_KEY`, or if the Render API is unreachable, the web service runs the same steps in-process.

**Every engine step is safe to rerun.** Steps rebuild state from receipts and skip work already recorded, so a workflow retry never duplicates a task, delivery, verdict, decision or payout.

**Task ids carry a per-mandate tag** (`T-<tag>-<n>`). Plain `T-1` ids repeated every demo week, and the projection keys tasks by id, so a second week would have re-decided the first week's deliveries under the new mandate. A test now runs two weeks back to back.

**One web service, no always-on worker.** The pay loop runs in the web process in inline mode and as workflow runs otherwise, which avoids paying for an idle background worker.

## 2026-10-14 (later)

**Gemini free tier is the default model provider.** The owner has no Anthropic API credits, and the hackathon allows any AI tool. Agents pick Gemini when `GOOGLE_GENERATIVE_AI_API_KEY` is set and Claude otherwise; `HANDOFF_AI_PROVIDER` forces one. Defaults: `gemini-3.8-flash` for ops, `gemini-3.5-flash-lite` for verifier and explainer.

**Large schemas enforce limits with refinements.** Gemini rejects response schemas above a complexity limit, so length, range and date limits on the ops and spec schemas are zod refinements: checked on every parsed response, but not sent as JSON-schema constraints. Strict objects (no extra keys) are still sent and enforced.

## 2026-10-14

**Amounts are integer cents everywhere.** The rate card, decisions and receipts store `amountMinor`. Conversion to PayPal's `"40.00"` strings happens only at the PayPal boundary (`minorToValue`). This removes floating-point drift and matches how payment standards export amounts.

**The mandate is AP2-shaped, not AP2-conformant.** It carries `vct`, `profile`, validity dates as both ISO strings and `iat`/`exp`, a `cnf` key binding and a presented-terms hash, plus labor constraints AP2 does not define (rate card, weekly cap, approval threshold). AP2 signs with ES256; this project signs with Ed25519, so it should be described as AP2-shaped.

**The decision key is per delivery, not per amount.** `decisionKey(mandateId, taskId, deliverySeq, verdictSeq)` stays the same if the rate card or ledger changes, so one delivery can never be paid twice. The idempotency check runs first.

**Checks fail closed and stop at the first failure.** Later checks are reported as `skipped`, so the UI shows exactly why a payout stopped.

**A missing W-9 or W-8BEN blocks the payout with an explanation.** Without a TIN, 24% backup withholding applies, and this app never holds funds, so it cannot withhold.

**Tax totals are informational.** The 1099-NEC ($2,000 for payments after 2025) and 1099-K ($20,000 and 200 payments) meters never block and never say "file". Payments through PayPal are generally reported by PayPal on 1099-K.

**Approvals bind to one decision hash and expire after 15 minutes.**

**The pay-run batch id comes from the sorted decision hashes.** The same decisions in any order give the same `sender_batch_id`, which PayPal rejects for 30 days, and it is also sent as `PayPal-Request-Id`.

**Payouts is fenced off twice.** `@handoff/paypal/payouts` is a separate entry point. ESLint's `no-restricted-imports` and `tests/architecture.test.ts` both fail if anything other than `packages/policy/src/execute.ts` (or the sandbox gate script) imports it. Both were checked against a planted rogue import.

**Chain verification links each receipt to the recomputed hash of the one before.** Editing one receipt therefore also breaks the next link, which makes the damage visible in the ledger.

**Checkpoints are co-signed with Ed25519 and ML-DSA-65.** NIST IR 8547 (draft) disallows EdDSA after 2035 and accepts dual signatures during the transition. Only checkpoints get the 3,309-byte ML-DSA signature, not every receipt.

**`@noble/post-quantum` instead of native crypto.** Node 22 has no ML-DSA (it arrived in Node 24.6). The library is self-audited and makes no constant-time claim, which is acceptable for server-held demo keys and is disclosed.

**Demo keys are deterministic and public.** `scripts/demo/keys.ts` derives them from labels, so anyone can reproduce the demo ledger. The README says plainly that the demo server holds every key: tamper evidence and attribution, not legal non-repudiation.

**Screening uses a fictional list.** `packages/policy/data/demo-screening-list.json` is labeled as not the OFAC SDN list. Exact matches block, near matches go to a person, and every result carries the list hash.

**Midnight is demoted to optional.** It is not a sponsor, its hosted Preprod endpoints shut down Oct 9, 2026, and its proofs are not post-quantum. The quantum-ready story rests on hashes and ML-DSA.

**Toolchain: TypeScript 5.9, ESLint 9, Vitest 5, pnpm 12, Node 22.** TypeScript 7 is the native compiler and typescript-eslint supports only up to 6.0, so 5.9 keeps linting working. Packages export their TypeScript sources directly; scripts run through `tsx`.
