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

## Next

1. Owner: connect the PayPal sandbox and add `ANTHROPIC_API_KEY`, then run `pnpm gate:payouts` and the webhook gate.
2. `packages/db`: Postgres schema with an append-only receipts table, the projection rebuild test, and the worker state machine (`FOR UPDATE SKIP LOCKED`).
3. `packages/agents`: ops, verifier and explainer, each with zod schemas, versioned prompts and the injection eval suite. Verifier reasons are never passed back to the ops agent.
4. `apps/web`: creator console, contractor portal, webhook route, a "Start demo" button, and AG Studio dashboards.
5. Propose-only MCP server (the agent door).
6. Deploy to Render, keep it live through Dec 15, then record the video.
