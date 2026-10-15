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

## Next

1. Owner: connect the PayPal sandbox and add `ANTHROPIC_API_KEY`, then run `pnpm gate:payouts` and the webhook gate.
2. `apps/worker`: the pay-run loop that ties the projection, the policy engine, the jobs table and `executePayRun` together, plus the webhook handler.
3. Run `pnpm gate:ai` and the verifier accuracy suite once `ANTHROPIC_API_KEY` is set.
4. `apps/web`: creator console, contractor portal, webhook route, a "Start demo" button, and AG Studio dashboards.
5. Propose-only MCP server (the agent door).
6. Deploy to Render, keep it live through Dec 15, then record the video.
