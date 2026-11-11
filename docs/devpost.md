# Devpost submission text

Paste these into the form. Notes in italics are for us, not for the form. Every number below was measured or is in the repo; if something changes, change the text.

## Project name

HandOff

## Tagline (under 60 characters if the form limits it)

Agents propose, plain code pays, receipts prove.

## Elevator pitch

The money layer for AI agents that hire and pay people, built on PayPal Payouts. A creator signs a mandate, AI agents plan and check the work, and a plain-code policy engine pays only inside the mandate. Every step is a signed receipt anyone can verify offline.

## Inspiration

AI agents can already plan a week of work and decide who should do what. What they cannot do is pay people safely. PayPal's agent tools serve the buying side: none of the toolkit's 43 tools sends money to a person. Meanwhile a creator running a studio with an AI producer has real questions before any agent touches their money. Is it allowed to spend this, at this rate, to this person? Was the work done to spec? Is the payee cleared? If something goes wrong, who can prove what happened? We wanted the answer to be "the agent proposes and plain code decides", with proof.

## What it does

A creator (Maya) signs a **labor mandate**: a rate card, a weekly cap, a payee list and an approval threshold. From there:

1. An **ops agent** (Gemini) turns her goal into tasks for her contractors. It sees rate lines and payees, never a dollar amount.
2. Contractors deliver, and a separate **verifier agent** (Gemini) checks each delivery against its spec in a fresh context with no tools. Code measures aspect ratio and duration, and a delivery passes only if the measurements and the model agree.
3. A **policy engine**, plain code with no model in it, runs nine ordered checks (signed mandate, not revoked, payee on the list, sanctions screening, tax form, verifier verdict, rate card, weekly cap, approval) and fails closed. It is the only code that can call PayPal Payouts.
4. Over the approval threshold, the creator signs that exact decision; the approval expires in 15 minutes.
5. The engine sends a **PayPal Payouts** batch. Each batch id is derived from the approved decisions, so a retry can never pay anyone twice. PayPal's webhooks, verified with PayPal's own API, confirm each payout.
6. Every step becomes a **signed, hash-chained receipt**, folded into Merkle checkpoints co-signed with Ed25519 and ML-DSA-65 (post-quantum). `pnpm verify` checks a ledger offline, and editing one payment breaks it at exactly that receipt.

**Money in** comes through **PayPal Invoicing**: the creator invoices a brand (the demo deal is Nova Audio, $500), PayPal holds the funds, and HandOff records what PayPal reports as a signed income receipt. Brand income and contractor payouts then sit side by side on the dashboard.

An **explainer agent** writes a plain-language summary of the week (who was paid, what was blocked and why, what waits for approval, and anything unusual), display-only and cached, with a plain-code fallback if the model is unavailable.

Other agents can use HandOff through a **propose-only MCP server**: they can read the rate card, propose work, follow tasks and verify the ledger. There is no payout tool, and no tool accepts an amount.

The **/ledger** page is built with AG Studio: spend against the cap, 1099 running totals per payee, a chain of receipts with a live Verify button, and a read-only AI Auditor that explains any decision.

## How we built it

- **TypeScript monorepo** on Node 22: `trust` (receipts, chains, Merkle checkpoints, envelope encryption), `policy` (mandate, `decide()`, approvals, pay-run executor), `paypal` (sandbox-only client), `db` (Postgres with append-only triggers; embedded PGlite for tests), `agents`, `engine`, `mcp`, and a Next.js 16 web app.
- **Hard boundaries enforced in code:** only one file may import the Payouts client, enforced by a lint rule and an architecture test; amounts come only from the signed rate card, in integer cents; agent output is validated against strict schemas and a response containing an amount is rejected.
- **Hosting:** Render. A Blueprint creates the web service, a Postgres database and a Render Workflows service that runs planning, one verification per delivery in parallel, the policy decision and settlement as separate retried tasks.
- **AG Studio ledger:** custom widgets (a receipt chain, 1099 meters), a theme tied to the site's light and dark palettes, and an agent built on the Studio Agent Framework that delegates to Studio's built-in agents. A small server bridge answers Studio's model turns with Gemini under per-minute, per-visitor and daily caps.

## Challenges we ran into

- **A verifier that was too kind.** Our first verifier prompt let two bad deliveries pass: a "wrong file, please ignore" note and a watermarked draft. We rewrote it so admissions against a delivery count and claims for it never do. The current version had no false passes across three runs of a 20-case suite.
- **Free-tier AI limits.** Gemini's free quota ran out mid-demo more than once. Every agent has a fallback (a scripted plan, measurement-only verification), and the Studio assistant is paced, capped, and degrades to a clear message while the dashboards keep working.
- **Structured output.** Gemini rejected complex JSON schemas, so the limits moved from the schema into validation code that runs on the response.
- **Proving a negative.** "The agent can't pay" is only credible if it is tested. We wrote injection evals that assume a compromised model that obeys everything, and an architecture test that fails the build if anything else can reach Payouts.
- **A leaked sandbox secret.** A credential reached GitHub through an example file early on. We caught it, had the app deleted, rewrote history, added a CI check that fails on tracked secret files, and now stage files by name.

## Accomplishments we're proud of

- Real PayPal sandbox payouts and invoices, confirmed by PayPal's own signed webhooks, end to end on the live site.
- **10 of 10** prompt-injection attacks blocked against a model that obeys every injected instruction.
- A **26-payout small-business run** (28 tasks, 8 payees, 10 rate lines, amounts from $15 to $210) sent as one PayPal batch in about 30 seconds, every payout confirmed, one failed delivery blocked, one approval declined, and an injected "$5,000" note ignored. 141 receipts verified offline.
- Verifier accuracy: all 58 completed cases correct and no bad work passed, across three runs on Gemini 3.5 Flash-Lite. Two cases hit the free quota and did not complete.
- 202 automated tests, a CI pipeline that also checks the demo ledger verifies and that tampering is caught, and a live MCP gate (9 of 9 checks) against the deployed site.

## What we learned

The valuable boundary is not "smart agent versus dumb agent" but "who is allowed to move money". Giving the model no path to money, and giving the code no discretion about amounts, made the system easier to reason about than any amount of prompt care. Receipts that can be verified without trusting our server turned out to be a better answer to "can I trust this?" than a dashboard.

## What's next

- **Invoicing by webhook:** invoice status is read from PayPal's API today; subscribing to PayPal's invoice events would record income the moment a brand pays. Brand income also does not yet raise the weekly cap: the cap is the creator's signed limit, and tying it to income is a policy decision we left to the creator.
- Contractor-facing view of their own receipts and 1099 totals.
- Stronger payee identity checks, and real (not demo) screening lists.
- Anchoring checkpoints outside the database (a public git repository or an RFC 3161 timestamp) on a schedule.
- Zero-knowledge "payee is cleared" attestations in place of the signed ones we use today.

## Built with

TypeScript · Node.js · Next.js · React · PayPal Payouts API · PayPal Webhooks · PayPal OAuth 2.0 · Google Gemini · Vercel AI SDK · Model Context Protocol · AG Studio (AG Grid) · Render (Web Service, Postgres, Workflows) · PostgreSQL · PGlite · Zod · Vitest · Ed25519 · ML-DSA-65 · Claude Code

## Try it out

- **Live demo:** https://agent-two-hand-handoff.onrender.com (no login)
- **Ledger dashboards:** https://agent-two-hand-handoff.onrender.com/ledger
- **Code:** https://github.com/createnexxusvision/Agent-Two-Hand-HandOff (Apache-2.0)

## Testing instructions for judges

No account or API key is needed. Everything is PayPal sandbox money.

1. Open the live demo and press **Start a demo week**. The page refreshes while the week runs (about a minute): tasks are planned, deliveries checked, and decisions made. One short comes back in the wrong orientation and is rejected, and one delivery note tries to order a $5,000 payout and is ignored.
2. Under **Waiting for Maya's approval**, press **Approve** on the $150 thumbnail pack. Watch the payout go to PayPal and turn confirmed, marked "verified by PayPal".
3. Under **Brand money in**, press **Invoice Nova Audio $500.00**, then **Record the brand's payment**. PayPal Invoicing sends the invoice and reports it paid; the payment becomes a signed income receipt. (In the sandbox this records a payment against the invoice, so no funds move.)
4. Open **/ledger**. Try the Tax tab, the Trust tab and **Verify now**. Press **Ask the AI Auditor or edit** and try "Why was a task blocked?".
5. Press **Summarize** under the ledger header to read the explainer agent's summary of the week.
6. Download the ledger with `/api/ledger`, then in a clone of the repo run `pnpm verify ledger.json` to check it offline.
7. *Limits you may hit:* invoices are limited to one a minute and five a day, and the Start button has a one-minute cooldown; the AI assistant uses a free Gemini quota that can run out; if it does, the page says so and everything else keeps working.

The MCP agent door at `/api/mcp` needs a bearer token we do not publish; `docs/mcp.md` describes it, and `pnpm gate:mcp` exercises it for anyone running their own deployment.

## Explain how your project meets the main technology requirement

HandOff integrates the PayPal developer platform in the free sandbox with Google's Gemini models. AI agents organize and check the work; PayPal moves the money, but only after plain code approves each payment against a mandate the creator signed.

**PayPal tools (all sandbox)**

- **PayPal Payouts API** (`POST /v1/payments/payouts`, batch and item lookup): the core of the project. It pays human contractors for verified work. Each batch id is derived from the approved decisions and is also sent as `PayPal-Request-Id`, so a retry can never pay anyone twice.
- **PayPal OAuth 2.0 (client credentials):** authenticates our server. Tokens are cached, and a startup guard refuses any address other than the sandbox.
- **PayPal Webhooks with the verify-webhook-signature API:** PayPal reports each payout's outcome. We confirm each event with PayPal before recording it as a signed receipt, and process each event once. A polling fallback reads batch status if a webhook is late.
- **PayPal Invoicing API (v2):** brings brand-deal money into the creator's own PayPal account. We create and send an invoice to the brand, read its status from PayPal, and record the payment PayPal reports as a signed receipt. The app never holds funds. Verified against the real sandbox (`pnpm gate:invoicing`, 7 of 7 checks).
- **PayPal sandbox accounts:** a funded business account pays personal accounts; the live site has sent sandbox payouts and the local load run sent 26 in one batch.

**AI tools**

- **Gemini 3.8 Flash (Google), ops agent:** turns the creator's goal into tasks and messages. It sees payees and rate lines but never a dollar amount, and code adds an AI disclosure to every message.
- **Gemini 3.5 Flash-Lite (Google), verifier, explainer and Studio assistant:** the verifier checks each delivery against its spec with no tools; the explainer writes the display-only weekly summary shown on /ledger (Summarize button), with a plain-code fallback; the Studio assistant answers the AG Studio chat. None can pay.
- **Vercel AI SDK:** connects the agents to Gemini with native structured output; a response with an extra field such as an amount is rejected. The same code runs on Anthropic's Claude by changing one setting.
- **Model Context Protocol:** a propose-only MCP server lets any agent read the rate card, propose work and verify the ledger. It has no payout tool.
- **Claude Code (Anthropic):** used to build the project, including code, tests, research and documentation.

**How they fit together:** agents propose, plain code pays, receipts prove. A deterministic policy engine is the only code that can call PayPal Payouts. It checks the creator's signed mandate, payee list, sanctions screening, tax form, the verifier's verdict, the rate card and the weekly cap, then pays through PayPal, waits for the creator's approval above the threshold, or blocks the payment with a reason. Every step becomes a signed, hash-chained receipt that anyone can verify offline.

## Sponsor tools

**AG Grid, "Best Use of AG Grid" (AG Studio).** The /ledger page is a full AG Studio dashboard rather than a grid. Polish: a theme mapped onto the site's own colour tokens so Studio, its grids and its charts follow light and dark mode and the amber, blue and green colour code that marks who acted. Custom widgets: a **receipt chain** (signed receipts as linked blocks, coloured by AI agent, plain code or person, with a Verify button that re-checks every signature and checkpoint on the server, and click-to-follow cross filtering by task) and **1099 meters** (per-payee progress toward the 1099-NEC line and the two-part 1099-K test). Agent Framework: the **HandOff Auditor** is a custom agent on Studio's harness that keeps the built-in Planning, Data, Page and Widget agents as delegates and adds four read-only tools of its own (verify the ledger, explain a task's decision, tax position, flags). A bridge answers Studio's model turns with Gemini instead of the OpenAI adapter in the sample. It is display-only by construction: Studio's tools edit widgets in the visitor's browser, and none of our tools can approve, pay or sign.

**Render.** The Blueprint deploys the web service, Postgres and a **Render Workflows** service. Workflows runs planning, one verification per delivery in parallel with retries, the policy decision and settlement as separate tasks that survive web redeploys. The site stays up through judging.

*Pre-submission checks: the live URL returns `"ok":true` at /api/health; the video is Public and under 3:00; the repo About shows the Apache-2.0 licence; no secret in the repo or its history; submitted before Nov 12, 12:00 pm PT. We are not claiming Midnight unless its anchoring step is verified on Preview before submission.*
