# Phase 0 gate results

Run with the commands shown. Results recorded 2026-10-14 on Node v22.23.2.

| Gate | Command | Result | Notes |
|---|---|---|---|
| 1 · PayPal OAuth + Payouts sandbox (must pass) | `pnpm gate:payouts` | **Pending** | Needs `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GATE_PAYEE_EMAIL_1`, `GATE_PAYEE_EMAIL_2` from the owner's sandbox. Checks a 2-item batch, the batch lookup, a replayed `sender_batch_id`, and the `ERRPYO005` insufficient-funds test value. |
| 2 · Webhooks | `pnpm gate:webhook` | **Pending** | Needs a public URL and `PAYPAL_WEBHOOK_ID`. Only real sandbox events pass `verify-webhook-signature`; dashboard simulator events cannot. |
| 3 · Signing, hash chain, checkpoints (must pass) | `pnpm gate:chain` | **Pass** (14/14) | A changed byte in each of 10 receipts is reported at its exact seq. A dual-signed checkpoint verifies, and it catches a truncated log that the hash chain alone accepts. |
| PQ · ML-DSA-65 co-signatures | `pnpm gate:pq` | **Pass** | Node 22 has no native ML-DSA, so `@noble/post-quantum` 0.7.1 is used. Public key 1,952 bytes, signature 3,309 bytes; about 10 ms to sign and 3 ms to verify. |
| 4 · AG Grid / AG Studio | not started | **Pending** | Ask the AG Grid team in the PayPal Discord for a key that lasts through Dec 15 before starting the 45-day trial. |
| AI · Claude structured output through the Vercel AI SDK | `pnpm gate:ai` | **Pending** | Needs `ANTHROPIC_API_KEY`. Runs each agent role with native structured output (`structuredOutputMode: "outputFormat"`, not a forced tool call) and checks the verifier fails a landscape file whose note demands payment. Confirms the model ids in `packages/agents/src/models.ts`. |
| 5 · Midnight | dropped from Phase 0 | **Demoted** | Midnight is not a hackathon sponsor, its hosted Preprod endpoints shut down Oct 9, 2026, and its proofs are not post-quantum. `PRIVACY=off` is the default. A half-day `anchorHead` attempt is allowed only after Phase 1 passes. |

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

PayPal steps in this demo ledger are marked `simulated` until gate 1 passes.
