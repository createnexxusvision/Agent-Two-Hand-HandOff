# CLAUDE.md

Agent Two Hand HandOff: the money layer for AI agents that hire and pay humans (PayPal AI Hackathon, submit by Nov 11, 2026).

**Start here: read [HANDOFF.md](HANDOFF.md) and follow its phases and gates in order.**

Rules that always apply:
- PayPal **sandbox only**. Guard against any non-sandbox base URL.
- Agents propose; plain code in `packages/policy` is the only path to Payouts. Amounts come only from the signed rate card, never from model output.
- No secrets in the repo, prompts, logs or receipts. PayPal credentials come from the connected connector or environment variables.
- `PRIVACY=off` must keep the full money loop working without Midnight.
- Every payout is idempotent (`sender_batch_id` derived from the decision hash).
- Tests first for `packages/policy` and `packages/trust`.
