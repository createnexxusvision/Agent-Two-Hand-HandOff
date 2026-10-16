# Phase 0 gate results

Run with the commands shown. Results recorded 2026-10-14 on Node v22.23.2.

| Gate | Command | Result | Notes |
|---|---|---|---|
| 1 · PayPal OAuth + Payouts sandbox (must pass) | `pnpm gate:payouts` | **Pass** (2026-10-14) | OAuth token issued; a 2-item $1.00 batch was accepted (`THP2UCNP5W77W`) and both items reached SUCCESS; replaying the same `sender_batch_id` was refused (400 USER_BUSINESS_ERROR), so a retry cannot pay twice; the `ERRPYO005` test value returned 422 INSUFFICIENT_FUNDS. |
| 2 · Webhooks | live site | **Pass** (2026-10-15) | Webhook registered at `https://agent-two-hand-handoff.onrender.com/api/webhooks/paypal`. Real sandbox events (item SUCCEEDED and batch PROCESSING and SUCCESS) arrive about 45 to 70 s after a payout and pass `verify-webhook-signature`; batch `T2UGRJELXDMQ4` was confirmed by webhook ("verified by PayPal"). Polling waits 2 minutes and stays as the fallback. `/api/health` reports verified events by type. |
| 3 · Signing, hash chain, checkpoints (must pass) | `pnpm gate:chain` | **Pass** (14/14) | A changed byte in each of 10 receipts is reported at its exact seq. A dual-signed checkpoint verifies, and it catches a truncated log that the hash chain alone accepts. |
| PQ · ML-DSA-65 co-signatures | `pnpm gate:pq` | **Pass** | Node 22 has no native ML-DSA, so `@noble/post-quantum` 0.7.1 is used. Public key 1,952 bytes, signature 3,309 bytes; about 10 ms to sign and 3 ms to verify. |
| MCP · agent door, live | `pnpm gate:mcp` | **Pass** (2026-10-16) | A real MCP client (spec 2026-07-28) against `/api/mcp` on Render: no token refused; exactly five propose-only tools; rate card read; proposal `P-a64c-1` recorded as signed receipt #88; an `amountMinor` field refused; `create_payout` does not exist; receipts paged; a blocked task explained (`verdict_pass`); chain verified (88 receipts). |
| 4 · AG Grid / AG Studio | not started | **Pending** | The AG Grid team confirmed entries won't be penalized over the license or trial; build on `/api/dashboard`. |
| AI · structured output through the Vercel AI SDK | `pnpm gate:ai` | **Pass** on Gemini (2026-10-14) | Free-tier Gemini key. Ops on `gemini-3.8-flash` planned 2 tasks and 2 messages that passed the mandate checks; verifier on `gemini-3.5-flash-lite` failed a landscape file whose note demanded payment; explainer flagged the note. Gemini rejected the full ops schema as too complex until length, range and date limits moved into code-side refinements (still enforced on every response). `gemini-2.5-flash` is closed to new users; `gemini-3.5-flash` returned "high demand" during testing. Claude remains selectable with `ANTHROPIC_API_KEY`. |
| 5 · Midnight | dropped from Phase 0 | **Demoted** | Midnight is not a hackathon sponsor, its hosted Preprod endpoints shut down Oct 9, 2026, and its proofs are not post-quantum. `PRIVACY=off` is the default. A half-day `anchorHead` attempt is allowed only after Phase 1 passes. |

## Live on Render (2026-10-15)

`https://agent-two-hand-handoff.onrender.com` runs the web service, Render Workflows and Postgres from `render.yaml`. A demo week runs as workflow runs: planning (`gemini-3.8-flash`), four verifications in parallel (`gemini-3.5-flash-lite`), decisions, then settlement. Batches paid live include `5M7NBA3AWFZVE` ($80), `3DNJ29EHPGHTQ` ($150, after approval) and `T2UGRJELXDMQ4` ($80, confirmed by webhook). The exported live ledger passes `pnpm verify`.

## End-to-end demo (offline)

`pnpm demo:ledger` then `pnpm verify .demo/ledger.json --anchors .demo/anchors`:

```
✓ seq 1–23 signatures and links valid
✓ checkpoint (size 14): Ed25519 + ML-DSA-65 valid, root matches, matches its anchored copy
✓ checkpoint (size 23): Ed25519 + ML-DSA-65 valid, root matches, matches its anchored copy
OK
```

After `pnpm demo:tamper` (Theo's $40.00 payout edited to $400.00):

```
✓ seq 1–19 signatures and links valid
✗ seq 20 HASH_MISMATCH: stored content does not match its hash
✗ seq 21 PREV_MISMATCH: prev does not match the hash of seq 20
✓ checkpoint (size 14): Ed25519 + ML-DSA-65 valid, root matches, matches its anchored copy
✗ checkpoint (size 23): root differs from the receipts stored now
exit 1 · broken at seq 20
```

Gate 1 now passes against the live sandbox. The demo ledger still marks its PayPal steps `simulated`; the worker will record real sandbox ids.
