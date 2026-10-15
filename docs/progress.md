# Progress

## 2026-10-14 · Core money loop, without PayPal credentials yet

Done and tested (102 tests, lint and typecheck clean):

- **Workspace:** pnpm, TypeScript, Vitest, ESLint, CI.
- **`packages/trust`:** canonical JSON, Ed25519 and ML-DSA-65 keys, signed hash-chained receipts, RFC 9162 Merkle proofs, dual-signed checkpoints, and `pnpm verify` for offline verification.
- **`packages/paypal`:** sandbox-only client, OAuth, retries, Payouts, webhook verification.
- **`packages/policy`:** labor mandate, `decide()`, approvals, demo screening, and `executePayRun()` as the only caller of Payouts.
- **Demo scripts:** `pnpm demo:ledger` replays the walkthrough week and `pnpm demo:tamper` shows tamper detection.
- **Gates:** 3 (chain) and PQ pass. Gates 1 and 2 wait for sandbox credentials. See [gates.md](gates.md).

Skipped and why:

- **Midnight (Gate 5):** demoted; see [decisions.md](decisions.md).
- **Live Payouts and webhooks:** they need the owner's sandbox app and accounts.

## 2026-10-14 (later) · Database, projection and agents

Done and tested (159 tests, lint and typecheck clean):

- **`packages/db`:** Postgres migrations with append-only triggers on receipts and checkpoints, encrypted payee addresses, webhook de-duplication, payout jobs claimed with `FOR UPDATE SKIP LOCKED`, and ledger export. Tests run on embedded PGlite, and they show that an admin who disables the trigger and edits a payout is still caught.
- **Projection (`packages/policy/src/projection.ts`):** week-to-date spend, tax running totals and already-paid deliveries are rebuilt from receipts.
- **Envelope encryption (`packages/trust/src/envelope.ts`):** AES-256-GCM with a per-record data key, bound to the record id.
- **`packages/agents`:** the ops, verifier and explainer agents, strict schemas, versioned prompts, the untrusted-text wrapper, and a default-deny gateway.
- **Evals:** 10/10 prompt-injection attacks blocked against a compromised model. See [evals.md](evals.md).
- **Devpost draft:** [devpost.md](devpost.md).

## 2026-10-15 · Deployable: web app, engine, Render Workflows

- **`packages/engine`:** the money loop against storage in retry-safe steps (mandate, plan, deliver and verify, decide, approve, pay, webhook, polling fallback, checkpoint). It refuses to act on a chain that does not verify.
- **`apps/web`:** Next.js demo site and PayPal webhook endpoint.
- **`apps/workflows`:** Render Workflows tasks; `render.yaml` validated against Render's schema. See [deploy.md](deploy.md).
- **Live local run (2026-10-15)** against the PayPal sandbox and Gemini: four tasks planned by `gemini-3.8-flash` and checked by `gemini-3.5-flash-lite`. $40 + $40 were paid in batch `DPKW6KCGKK3CG`; the landscape short was blocked; Ana's $150 was approved and paid in batch `XRAXP2SBNPMV6`. All three items SUCCEEDED, and `pnpm verify` passes on the exported ledger.
- 169 tests, lint and typecheck clean; CI also builds the web app.

## Where we ended (2026-10-15, end of day)

**Live:** https://agent-two-hand-handoff.onrender.com. It runs the web service, Render Workflows (`handoff-workflows`) and Postgres (`handoff-db`), deployed from `render.yaml`. It costs $17.50 a month against a $50 Render credit, and must stay up through Dec 15, ideally Dec 21.

**All gates pass except AG Grid:**

| Gate | Result |
|---|---|
| 1 · Payouts | Pass |
| 2 · Webhooks | Pass, live |
| 3 · Receipt chain | Pass |
| PQ · ML-DSA-65 | Pass |
| AI · Gemini free tier | Pass |
| 4 · AG Grid | **Open** |
| 5 · Midnight | Demoted |

**Verified live:** a full demo week runs as workflow runs.
1. Planning, then four verifications in parallel.
2. Decisions: $40 + $40 approved, the landscape short blocked, $150 held for approval.
3. Approval, then settlement through PayPal Payouts.
4. Confirmations arrive through PayPal webhooks ("verified by PayPal").
5. The exported live ledger passes `pnpm verify`.

**Repo:** `main` at `7049eb8`. PRs #1 to #7 are merged, CI is green, and there are 173 tests.

**Owner's setup:**
- Local `.env` has the sandbox credentials, two payee emails, the Google AI key and the webhook id.
- Render has the same secrets plus a Render API key.

**Open owner items:**
- Confirm the old PayPal sandbox app (Client ID starting `AQop`) is deleted.
- Ask the AG Grid team in the PayPal hackathon Discord for an AG Studio key that lasts through Dec 15. Don't start the 45-day trial before Oct 31.

## Next session plan (start here)

**Pick up from:** `main` at `7049eb8`, with the live site healthy. Begin with `curl https://agent-two-hand-handoff.onrender.com/api/health`. It should show `"ok": true`, `"runs": "render-workflows"` and `"webhooks": true`.

**Target output for the day:**

1. **Propose-only MCP server (the agent door)**
   - Build: an MCP endpoint on the web service (`/api/mcp`, MCP spec 2026-07-28, stateless) over the existing default-deny gateway.
   - Tools:
     - `list_rate_lines`
     - `propose_task`: creates a signed PROPOSAL, never an amount.
     - `get_task_status`
     - `list_receipts`
     - `verify_chain`
   - Auth: a labeled demo bearer token stored in Render.
   - Done when an MCP client (Claude Desktop or the MCP inspector) can call each tool against the live site, and a `create_payout` call or an amount field is refused. Tests cover both.
2. **Live verifier accuracy eval**
   - Build: 20 delivery cases (good, bad, borderline), run against Gemini. Results go to `docs/evals.md` and the `eval_runs` table.
   - Done when the score is recorded honestly. The target is 18 or more out of 20.
3. **AG Studio ledger, only if the key has arrived**
   - Build from the PayPal AG Grid boilerplate: receipts with a Verified/Broken status, two 1099 meters, budget against the cap, and the explainer summary.
   - If there's no key yet, build the data endpoints the dashboards will read, and do the visual part on a later day.

**Not today:** Invoicing (brand money in), the demo video and the Devpost write-up. These are scheduled below.

## Schedule to the deadline

| Window | Goal |
|---|---|
| Oct 16 to 19 | MCP agent door, live verifier eval, AG Studio data endpoints |
| Oct 20 to 26 | AG Studio dashboards (with the key), PayPal Invoicing for brand money, explainer summary on the site |
| Oct 27 to Nov 2 | Polish: README and architecture diagram, security notes, honest limits, accessibility, demo-week reset for judges |
| Nov 3 to 9 | Record the public YouTube video (under 3:00, real voice or generated voiceover), screenshots, Devpost text from `docs/devpost.md` |
| Nov 10 | Submit on Devpost, a day ahead of the Nov 12, 12:00 pm PT close. Keep the site running through Dec 21. |

## Next

1. Owner: connect the PayPal sandbox and add `ANTHROPIC_API_KEY`, then run `pnpm gate:payouts` and the webhook gate.
2. `apps/worker`: the pay-run loop that ties the projection, the policy engine, the jobs table and `executePayRun` together, plus the webhook handler.
3. Run `pnpm gate:ai` and the verifier accuracy suite once `ANTHROPIC_API_KEY` is set.
4. `apps/web`: creator console, contractor portal, webhook route, a "Start demo" button, and AG Studio dashboards.
5. Propose-only MCP server (the agent door).
6. Deploy to Render, keep it live through Dec 15, then record the video.
