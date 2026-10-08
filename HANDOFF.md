# HANDOFF: Build, Ship and Deploy

Instructions for Claude Code. Read this whole file first, then work the phases in order. Each phase ends with a gate. Do not start the next phase until the gate passes.

**Project:** Agent Two Hand HandOff, the money layer for AI agents that hire and pay humans. A creator's ops agent assigns work at agreed rates, a verifier agent checks it, plain code pays through PayPal Payouts inside a signed mandate, and every step becomes a signed, hash-chained receipt. Midnight (Preprod) adds optional privacy.

**Goal:** a working, public, deployed demo plus an under-3-minute video for the PayPal AI Hackathon.
**Deadline:** submit by **Wed Nov 11, 2026**. Hard close is Thu Nov 12, 12:00 pm PST (2:00 pm CT). Today is early October, so there is slack, but the budget is a 72-hour focus cap, so protect it.
**Repo:** https://github.com/createnexxusvision/Agent-Two-Hand-HandOff (public, Apache-2.0).

---

## 0. Non-negotiables

1. **Sandbox only.** `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com`. Never call `api-m.paypal.com`. Add a startup guard that throws if the base URL is not the sandbox host.
2. **Agents never pay.** Only `packages/policy` may import `packages/paypal` payout functions. Enforce with an ESLint `no-restricted-imports` rule plus a test that fails if any file under `packages/agents` imports the payouts module.
3. **Amounts come only from the signed rate card.** No model output is ever parsed into an amount. Agents reference a `rateLineId`; code looks up the amount.
4. **Untrusted text is data.** Delivery notes, file names, payee-supplied strings are wrapped and labelled as data in prompts, and agent outputs are schema-validated (zod). On a schema failure: reject, log, no retry that loosens the schema.
5. **No secrets in the repo, prompts, logs or receipts.** PayPal credentials come from the connector the owner attaches, or from environment variables. Never ask the user to paste credentials into chat. Never commit `.env`. `.gitignore` already blocks it.
6. **`PRIVACY=off` must always work.** The whole money loop runs without Midnight. Midnight is additive.
7. **Be honest in the UI and README.** Server holds all demo keys, so this is tamper evidence and attribution, not legal non-repudiation. Screening is a demo list. The 1099 tracker tracks totals only. Nothing is tax, legal or compliance advice.
8. **No third-party trademarks or copyrighted music** in the app, README or video.
9. **Every payout is idempotent.** `sender_batch_id` is derived from the approved DECISION record hash, so retries can never double pay.
10. **Commit trailers.** End every commit message with:
    ```
    Co-Authored-By: Claude <noreply@anthropic.com>
    ```
    (Use the attribution lines the session supplies if they differ.)

---

## 1. What the owner does (you cannot do these)

Ask for these once, up front, as a short checklist. Then continue with everything that does not depend on them.

- [ ] **Connect PayPal via the connector.** Sandbox app with Payouts, Invoicing and Webhooks enabled. Also needs: a sandbox **business** account (sender, funded) and 3 sandbox **personal** accounts (payees).
- [ ] Provide `ANTHROPIC_API_KEY` as an environment secret (not in chat).
- [ ] Create a **Render** account (hackathon credits are available) and connect the GitHub repo.
- [ ] Set the repo **About** description and topics on GitHub (suggested text: "The money layer for AI agents that hire and pay humans. PayPal Payouts, signed receipts, Midnight privacy.").
- [ ] Midnight (only if the gate passes, see Phase 0): install Lace wallet, fund Preprod tNIGHT from the faucet, generate tDUST.
- [ ] Record and upload the video to YouTube; submit on Devpost.

If the PayPal connector exposes tools in this session, use them for account setup, sandbox checks and webhook registration. If it only supplies credentials, read them from the environment. If neither is available, write the code against the documented REST API and mark the live tests as pending.

---

## 2. Stack and layout

TypeScript monorepo, pnpm workspaces, Node.js 22.

```
apps/web/            Next.js (App Router): creator console, contractor portal, ledger, /api/webhooks/paypal
apps/worker/         Node worker: pay-run loop, payout polling, retries
packages/agents/     ops, verifier, explainer: prompts, zod schemas, Vercel AI SDK wiring
packages/policy/     plain-code mandate checks. NO model calls. The only caller of payouts.
packages/paypal/     OAuth, Payouts, Invoicing, webhook verification (direct REST via fetch)
packages/trust/      keys, signing, canonical JSON, hash chain, encryption, verify CLI
packages/privacy/    Compact contract, proof calls, PRIVACY=off stub
packages/db/         Postgres schema and migrations (drizzle or plain SQL)
evals/               verifier cases and injection cases
docs/                architecture notes, demo script
```

Key choices:
- **PayPal:** direct REST for Payouts (not confirmed in `@paypal/agent-toolkit`). Optionally use the toolkit or PayPal MCP for the Invoicing path if it works cleanly. Hyperwallet counts as PayPal but is not needed.
- **AI:** Claude through the Vercel AI SDK (`ai`, `@ai-sdk/anthropic`). Use a fast model for verifier/explainer, a stronger one for ops if needed. Keep model IDs in one config file.
- **Crypto:** Node `crypto` only (Ed25519, SHA-256, AES-256-GCM). RFC 8785 canonical JSON via a small vetted library or a tested in-repo implementation.
- **DB:** Postgres (Render managed). Receipts table is append-only; add a DB trigger or app-level guard that rejects UPDATE/DELETE.
- **UI grid:** AG Grid. Check Community vs Enterprise before using a feature; Community is fine unless a feature needs Enterprise. Never commit a license key.

---

## 3. Phase 0: Gate tests (about 4 hours). Do these before product code.

Scaffold the monorepo (pnpm, tsconfig, lint, vitest, CI workflow) first, then prove each risky assumption with a tiny script in `scripts/gates/`. Record results in `docs/gates.md`.

| # | Gate | Pass condition | If it fails |
|---|------|----------------|-------------|
| 1 | PayPal OAuth + **Payouts sandbox** | `POST /v1/payments/payouts` with a 2-item batch returns 201; batch GET shows items; payees' sandbox balances update | Payouts not enabled on the app: enable in Developer Dashboard; if impossible, fall back to Invoicing + Orders flow and say so |
| 2 | **Webhooks** | A public URL (Render or tunnel) receives `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` and passes `POST /v1/notifications/verify-webhook-signature` | Fall back to polling batch status; keep webhook code as best effort |
| 3 | **Crypto + chain** | Sign 10 records, verify chain, mutate one byte, verify reports the exact broken `seq` | Must pass; this is core |
| 4 | **AG Grid** | Grid renders 1,000 receipt rows with custom cell renderer (Verified/Broken) and grouping on the chosen license | Drop the unsupported feature, keep basic grid |
| 5 | **Midnight** (half-day time box) | Compile a minimal Compact contract, run the local proof server (Docker, 127.0.0.1:6300), deploy to Preprod, call one circuit | Set `PRIVACY=off` permanently, keep the stub, mention Midnight as roadmap only if the honest answer is "not working" |

Also confirm during Gate 1: whether forced-error simulation is supported for Payouts (use `PayPal-Mock-Response` or sandbox negative-testing headers if available); if not, simulate failures by posting a signed fake webhook through the verifier-bypassing **test-only** path that is compiled out of production builds.

**Gate:** 1 and 3 must pass. 2, 4, 5 may degrade per the table. Commit `docs/gates.md` with results.

---

## 4. Phase 1: Core money loop (about 24 hours)

Build the thinnest end-to-end path first, with minimal UI, CLI or API driven.

### 4.1 Domain model
- `Mandate` (signed by creator): payees (id, display name, salted payee hash, PayPal email held encrypted), rate cards (`rateLineId`, description, unit, amount, currency), weekly cap, approval threshold (default `APPROVAL_THRESHOLD_USD=100`), validity window.
- `Task` (created by ops agent): `rateLineId`, payee, spec, due date.
- `Delivery`: payee submits notes/links/files metadata.
- `Verdict` (verifier agent): `{ pass: boolean, reasons: string[], confidence }`.
- `Decision` (policy engine): deterministic result of checks, computed amount, `needsApproval`.
- `Approval` (creator): signed yes/no when over threshold.
- `Payout` and `Confirmation` (webhook-driven).

### 4.2 Policy engine (`packages/policy`), pure functions with exhaustive tests
Checks, in order. Any failure blocks and logs a DECISION with the reason:
1. Mandate valid, signature verifies, within validity window.
2. Payee is on the mandate's approved list and payee-cleared (see screening).
3. `rateLineId` exists in the mandate; amount = rate × quantity from the card (never from the model).
4. Amount ≤ per-line cap and week-to-date + amount ≤ weekly cap.
5. Verdict is `pass`.
6. Demo sanctions/screening check against a bundled sample list (clearly labelled demo).
7. Year-to-date total for the payee (for the 1099 tracker); flag when crossing the threshold. Threshold default **$2,000** (IRS 1099-NEC for payments after 2025; verify against irs.gov before showing it in the UI and cite the source in the UI footer).
8. If amount > approval threshold: status `NEEDS_APPROVAL`; payout only after a signed APPROVAL.
9. Idempotency: if a PAYOUT for this decision hash exists, return it, do not call PayPal.

### 4.3 PayPal client (`packages/paypal`)
- OAuth2 client-credentials with in-memory token cache and expiry margin.
- `createPayoutBatch(items, senderBatchId)` → `POST /v1/payments/payouts` with `sender_batch_header.sender_batch_id`, `email_subject`, items with `recipient_type: EMAIL`, `amount {value, currency}`, `sender_item_id`, `receiver`.
- `getBatch(batchId)`, `cancelItem(itemId)` for unclaimed.
- `verifyWebhook(headers, body)` using `POST /v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`.
- Invoicing v2: create + send invoice for a brand payment, and handle `INVOICING.INVOICE.PAID`. This is the inbound half of the story.
- Retries with backoff on 5xx/429 only. Never retry a 4xx. Log PayPal `PayPal-Debug-Id` on every failure.
- Notes: sender pays Payouts fees; unclaimed payouts return after 30 days; Standard Payouts has no 1099 reporting.

### 4.4 Agents (`packages/agents`)
- **Ops agent:** tools `listOpenWork`, `assignTask(rateLineId, payeeId, spec)`, `createInvoice(...)`. Cannot set amounts, cannot call payouts, has no payout tool in scope at all.
- **Verifier agent:** fresh context per delivery, input is spec + delivery (labelled untrusted), never sees budget, balances or other deliveries. Output zod schema `Verdict`.
- **Explainer agent:** reads receipts, writes a plain-language pay-run summary and anomaly flags (duplicate deliveries, unusual timing, amount near threshold).
- Optional: **Agreement reader** that drafts rate cards from pasted text; output is a draft the creator must sign. Only build if time remains.
- Keep prompts in `packages/agents/prompts/*.md`, versioned, short, with the data-labelling convention.

### 4.5 Worker (`apps/worker`)
Loop: pick verified deliveries → policy → (approval) → payout → poll/await webhook → confirmation. Single-process is fine. Use a DB row lock or advisory lock so two workers cannot pay the same decision.

**Gate (Phase 1):** run a scripted scenario against sandbox: mandate → 3 tasks → 3 deliveries (one fails verification, one over threshold needing approval, one clean) → exactly the right payouts occur, balances update, rerunning the script creates zero duplicate payouts.

---

## 5. Phase 2: Trust and privacy (about 20 hours)

### 5.1 Receipts (`packages/trust`)
- Record types: `MANDATE, TASK, DELIVERY, VERDICT, DECISION, APPROVAL, PAYOUT, CONFIRMATION, ANCHOR`.
- Each record: `{ seq, type, prev, body, hash, sig }` where `hash = sha256(canonical({seq,type,prev,body}))` and `sig` is Ed25519 over `hash` by the acting key.
- Keys per actor: `creator`, `ops-agent`, `verifier`, `policy-engine`, `webhook-handler`. Key ids include a date suffix. Private keys stored encrypted; demo server holds them (say so).
- Example shape:
  ```json
  {"seq":42,"type":"DECISION","prev":"sha256:…","body":{"task":"…","verdict":"…","rateLine":"short-edit-v1","amount":{"value":"40.00","currency":"USD"},"checks":{"withinRate":true,"withinCap":true,"payeeCleared":true,"ytdUnderThreshold":true},"needsApproval":false},"hash":"sha256:…","sig":{"key":"policy-engine-2026-11","alg":"Ed25519","value":"…"}}
  ```
- Only the policy engine key may sign DECISION; only webhook-handler may sign CONFIRMATION; enforce at write time.
- **Encryption:** personal data (emails, names) AES-256-GCM with a per-record data key wrapped by `TRUST_MASTER_KEY`. The chain stores salted hashes of payee identifiers, never raw emails.
- **`verify` CLI:** `pnpm verify` walks the chain, recomputes hashes, checks signatures and actor permissions, prints OK or the first broken `seq` and why. Exit code non-zero on failure.
- **Tamper demo:** an admin-only script that edits a stored amount directly in Postgres so the UI flips to Broken. This is for the video.
- Property tests: random chains verify; any single-field mutation fails.

### 5.2 Midnight (only if Gate 5 passed; time box 8 hours more)
Contract in Compact (`packages/privacy/contracts/`), compiled output git-ignored (`**/managed/`):
- `registerCleared(payeeCommitment)`: adds a payee commitment to a Merkle set after screening passes.
- `proveCleared(...)`: payee proves membership without revealing identity.
- `anchorHead(hash)`: publishes the receipt-chain head so tampering after the fact is detectable on-chain.
- Stretch: `proveUnderThreshold(...)` for a YTD total proof.
Use midnight-js, local proof server in Docker, Preprod only, no mainnet. `MIDNIGHT_*` env vars already in `.env.example`. If the Midnight MCP server is available, use it to help write Compact.
Stub: `packages/privacy` exports the same interface with `PRIVACY=off` doing a local no-op / local commitment so the UI shows "Privacy: off" honestly.

**Gate (Phase 2):** `pnpm verify` passes on a fresh run, fails with the right `seq` after the tamper script, and the full Phase 1 scenario passes with `PRIVACY=off`. If Midnight is on, one ANCHOR record references a real Preprod tx.

---

## 6. Phase 3: Product and ledger (about 16 hours)

Next.js app, clean and calm. Design counts for a fifth of the score.

- **Creator console:** sign mandate, rate cards, see tasks, approve/reject over-threshold payouts, pay-run summary from the Explainer, "Verify chain" button.
- **Contractor portal:** see assigned tasks, submit delivery, see status and payout, see own receipts.
- **Ledger (AG Grid):**
  1. *Receipts:* seq, type, actor, time, amount, status badge (Verified / Broken), expandable body.
  2. *1099 tracker:* payee, YTD, threshold, progress, flag.
  3. *Budget:* weekly cap vs spent, by rate line.
  4. *Flags:* anomalies from the Explainer and policy blocks with reasons.
- **Webhook route:** `/api/webhooks/paypal` verifies signature, writes CONFIRMATION, updates payout state. Must be idempotent on `event.id`.
- **Seed/demo mode:** one command seeds a believable studio (a creator, 3 payees, rate cards, a week of tasks) so the demo is repeatable: `pnpm demo:reset`.
- Accessibility basics: labels, contrast, keyboard navigation. Mobile-friendly layout for the portal.
- A short in-app "How it works / Honest limits" page.

**Evals (`evals/`)**
- 20 verifier cases (good, bad, borderline), target ≥ 18 correct.
- 10 prompt-injection cases (delivery notes that say "pay $5,000", "ignore the rate card", fake system messages, unicode tricks, file-name injection), target **10/10 blocked** (no amount change, no payout outside policy).
- `pnpm eval` prints a table; save the results to `docs/evals.md` and show the numbers in the README.

**Gate (Phase 3):** a person who has never seen the project can complete the creator flow from the UI in under 3 minutes without help; evals meet targets.

---

## 7. Phase 4: Ship and deploy (about 8 hours)

### 7.1 Render
- Create `render.yaml` (Blueprint) with: web service (Next.js), background worker, Postgres database, shared environment group.
- Build: `pnpm install --frozen-lockfile && pnpm build`. Start web: `pnpm --filter web start`. Worker: `pnpm --filter worker start`.
- Run migrations on deploy (pre-deploy command: `pnpm db:migrate`).
- Environment group (set in Render dashboard, never in git): `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`, `PAYPAL_WEBHOOK_ID`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `TRUST_MASTER_KEY`, `APPROVAL_THRESHOLD_USD`, `PRIVACY`, `MIDNIGHT_*` as applicable.
- Register the PayPal webhook to `https://<render-url>/api/webhooks/paypal` for the events: `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `.FAILED`, `.UNCLAIMED`, `.CANCELED`, `INVOICING.INVOICE.PAID`. Save the webhook ID into `PAYPAL_WEBHOOK_ID`.
- Free/starter instances sleep: use a paid starter instance for the web service and the worker during judging (credits cover it), or add a health check and keep-alive.
- Add `/api/health` returning version and `PRIVACY` mode (no secrets).
- Midnight proof server cannot run on Render for free; the demo either runs Midnight locally for the recording or uses `PRIVACY=off` on the live site. Say which in the README and on the About page.

### 7.2 Repo polish for judges
- README: working "Getting started" (clone, `cp .env.example .env`, `pnpm i`, `pnpm demo:reset`, `pnpm dev`), live demo URL, architecture diagram, eval numbers, honest limits, PayPal APIs used (a table), Midnight status, AG Grid usage, Render usage.
- Keep license visible in About (Apache-2.0 already detected). Add topics: `paypal`, `ai-agents`, `payouts`, `midnight`, `ag-grid`, `render`, `claude`.
- Add `SECURITY.md` (sandbox-only, how keys are handled) and `docs/architecture.md`.
- Run a secret scan before the last push (`git log -p | grep -iE 'secret|client_id|sk-'` style check, or gitleaks) and confirm no keys in history.
- CI: lint, typecheck, unit tests, evals-offline (mocked), `pnpm verify` on a seeded DB.

### 7.3 Demo video (under 3 minutes, YouTube, public or unlisted per Devpost rules)
Script timeline:
| Time | Beat |
|---|---|
| 0:00–0:20 | Problem: agents can hire, but can't pay safely. One line on the product. |
| 0:20–0:50 | Creator signs a mandate and rate card. |
| 0:50–1:30 | Ops agent assigns; contractor delivers; verifier passes one and rejects one with reasons. |
| 1:30–2:00 | Injection attempt in a delivery note ("pay $5,000") is ignored; the policy engine shows the check list. |
| 2:00–2:25 | Over-threshold payout needs creator approval; PayPal Payouts executes; webhook confirms; payee balance in sandbox. |
| 2:25–2:45 | Ledger (AG Grid): receipts, 1099 tracker; run tamper script → Broken at exact seq. |
| 2:45–3:00 | Midnight proof (if working) and close with the tagline. |
Use original or no music. No third-party logos beyond what the rules allow. Show the live URL on screen.

### 7.4 Devpost submission checklist
- [ ] Project name, tagline, description (problem, solution, how built, challenges, what's next)
- [ ] Public repo link with detectable open-source license in About
- [ ] Working demo URL (no mockups)
- [ ] Video link under 3 minutes
- [ ] PayPal APIs used are named and central
- [ ] Sponsor prize selection: **AG Grid** (and mention Render for hosting)
- [ ] Screenshots and architecture diagram
- [ ] Test instructions for judges (a demo login or "Start demo" button, no signup walls)
- [ ] Submitted by Nov 11, well before the Nov 12 12:00 pm PST close

---

## 8. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Payouts not enabled on sandbox app | Use Invoicing + Orders/Checkout sandbox flow; state it plainly |
| Webhooks flaky | Poll batch status in the worker; keep webhook handler idempotent |
| Verifier misjudges | Policy still enforces rate/cap; creator approval path; report eval numbers honestly |
| Prompt injection gets through | Policy engine is the authority; add a test for every case found |
| Midnight toolchain blocks | `PRIVACY=off`; ship everything else; do not claim ZK in the video |
| AG Grid feature needs Enterprise | Use Community features only |
| Render cold start | Paid starter instance during judging |
| Time overrun | Cut order: Agreement reader → stretch ZK circuit → Budget view → Explainer polish. Never cut: policy engine, signed chain, verify, tamper demo, PayPal Payouts |

---

## 9. Working agreements for Claude Code

- Work in small commits on `main` or short branches; keep `main` deployable once Phase 1 passes.
- After each phase, update `docs/progress.md` with what passed, what was skipped and why.
- Prefer simple, boring code. No new dependency without a one-line reason in the PR/commit.
- Tests first for `policy` and `trust`; they are the heart of the project.
- When something external is unverified (API behaviour, license tiers, tax thresholds), check the official docs, then record the source and date in `docs/gates.md` or the relevant doc.
- Ask the owner only for the items in section 1. Decide everything else and note the decision in `docs/decisions.md`.
- Open question to raise once with the owner: who is the first payer in the demo narrative, a creator paying their team, or a studio paying instructors. Default to the creator-paying-team story unless told otherwise.
