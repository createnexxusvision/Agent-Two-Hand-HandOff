# Agent Two Hand HandOff

**AI agents can plan and hire. This is how they pay real people safely.**

Agent Two Hand HandOff is the money layer for AI agents that hire and pay humans, built on PayPal. A creator's operations agent assigns work to their human team, an independent agent checks the work, and plain code pays each person through PayPal Payouts, but only inside a mandate the creator signed. Every dollar comes with a signed, tamper-evident receipt, and payee privacy is protected with zero-knowledge proofs on Midnight.

> **Status:** planning complete, build in progress for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (deadline Nov 12, 2026).
> **Sandbox only.** No real money moves. Nothing here is tax, legal or compliance advice.

---

## The problem

By 2030 a creator can run a one-person studio with an AI agent as producer. The agent can already plan the week and pick who does what. What it cannot do today is pay real people safely:

- Is the agent allowed to spend this, at this rate, to this person?
- Was the work actually done to spec?
- Is the payee who they say they are, and cleared to be paid?
- If something goes wrong, who can prove what happened?

Agent-to-human labor marketplaces already exist, but they pay in stablecoins with little identity, tax or dispute protection. Those are PayPal's strengths.

## How it works

```
Creator signs a mandate (rate cards, weekly cap, approved payees, approval threshold)
        |
Ops agent assigns a task at an agreed rate line
        |
Contractor delivers the work
        |
Verifier agent: does it meet the spec? --no--> no pay, reason shown
        | yes
Policy engine (plain code): rate card, budget, verified payee,
screening, year-to-date total --fails--> blocked and logged
        | passes (over the threshold, the creator approves)
PayPal Payouts batch
        |
Signed receipt, chained to the mandate and the task
```

**Agents propose, plain code pays, and every step is signed.** The payout call is reachable only from the policy engine, and amounts come only from the signed rate card, so text inside a delivery can never set a payout.

## What's inside

| Part | What it does |
| --- | --- |
| **PayPal** | Invoicing brings brand money in; Payouts pays the team; verified webhooks confirm every payout |
| **AI agents** | Ops (assigns and chases work), Verifier (checks deliveries, cannot pay), Explainer (plain-language pay-run summaries and anomaly flags) |
| **Policy engine** | Deterministic code that enforces the mandate; the only path to the Payouts call |
| **Trust layer** | Ed25519 signatures per actor, a SHA-256 hash chain of receipts (RFC 8785 canonical JSON), AES-256-GCM encryption for personal data |
| **Privacy layer** | A Compact contract on Midnight Preprod: payees prove they are cleared without revealing who they are; receipt-chain heads are anchored on-chain |
| **Ledger** | AG Grid views: receipts with Verified or Broken status, a 1099 threshold tracker, budget against cap, anomaly flags |

## Planned repo layout

```
apps/web/            Next.js: creator console, contractor portal, ledger, webhook route
apps/worker/         pay-run worker
packages/agents/     ops, verifier, explainer prompts and tool wiring
packages/policy/     plain-code mandate checks (no model calls)
packages/paypal/     Payouts, webhooks, invoices clients
packages/trust/      keys, signing, hash chain, encryption, verify CLI
packages/privacy/    Compact contract, proof calls, PRIVACY=off stub
packages/db/         schema and migrations
evals/               verifier and prompt-injection test cases
```

## Stack

TypeScript on Node.js 22 · Next.js · Postgres · Claude via the Vercel AI SDK · `@paypal/agent-toolkit` plus the PayPal REST APIs (sandbox) · Node `crypto` · Midnight Compact and midnight-js (Preprod) · AG Grid · hosted on Render.

## Getting started

Setup instructions arrive with the first runnable build. Copy `.env.example` to `.env` and fill in sandbox values only. Midnight is optional: set `PRIVACY=off` to run everything else without it.

## Honest limits

- Sandbox only; PayPal moves all money, so funds never sit with this app.
- In the demo the server holds every signing key, so receipts give tamper evidence and attribution, not legal non-repudiation.
- Screening uses a demo list and the 1099 tracker only tracks totals; neither is a compliance tool, and nothing here files tax forms or decides worker classification.

## License

[Apache License 2.0](LICENSE)
