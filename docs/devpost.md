# Devpost answers (drafts)

Keep these in step with what actually runs on submission day. Status notes in italics are for us, not for the form.

## Explain how your project meets the main technology requirement

Agent Two Hand HandOff integrates the PayPal developer platform in the free sandbox with Google's Gemini models. AI agents organize and check the work; PayPal moves the money, but only after plain code approves each payment against a mandate the creator signed.

**PayPal tools (all sandbox)**

- **PayPal Payouts API** (`POST /v1/payments/payouts`, batch and item lookup, cancel unclaimed): the core of the project. It pays human contractors (editors, designers) for verified work. Each batch id is derived from the approved decisions and also sent as `PayPal-Request-Id`, so a retry can never pay anyone twice.
- **PayPal OAuth 2.0 (client credentials):** authenticates our server. Tokens are cached, and a startup guard refuses any address other than the sandbox.
- **PayPal Webhooks with the verify-webhook-signature API:** PayPal reports each payout's outcome (succeeded, failed, unclaimed, returned). We confirm each event with PayPal before recording it as a signed receipt, and process each event once.
- **PayPal Invoicing API (v2):** brings brand-deal money into the creator's own PayPal account. The app never holds funds. *(Not built yet.)*
- **PayPal sandbox accounts and Payouts test values:** a funded business account pays personal accounts; Payouts' own test values (for example `ERRPYO005`, insufficient funds) demonstrate failure handling.

**AI tools**

- **Gemini 3.8 Flash (Google), ops agent:** turns the creator's goal ("ship 3 shorts this week") into tasks for the team and writes the messages. It sees payees and rate lines but never a dollar amount, and code adds an AI disclosure to every message.
- **Gemini 3.5 Flash-Lite (Google), verifier agent:** checks each delivery against its spec with a fresh context and no tools. Code measures aspect ratio and duration; a delivery passes only if the measurements and the model agree.
- **Gemini 3.5 Flash-Lite (Google), explainer agent:** writes a plain-language summary of each pay run and flags anomalies, such as a delivery note that tries to give payment instructions. Display-only.
- **Vercel AI SDK:** connects the agents to Gemini with native structured output; every response must match a strict schema, and a response with an extra field (such as an amount) is rejected. The same code runs on Anthropic's Claude by changing one setting.
- **Claude Code (Anthropic):** used to build the project, including code, tests, research and documentation.

**How they fit together:** agents propose, plain code pays, receipts prove. A deterministic policy engine is the only code that can call PayPal Payouts. It checks the creator's signed mandate, payee list, sanctions screening, tax form, the verifier's verdict, the rate card and the weekly cap, then pays through PayPal, waits for the creator's approval above $100, or blocks the payment with a reason. Every step becomes a signed, hash-chained receipt that anyone can verify offline. Against a model that obeys every injected instruction, all 10 prompt-injection attacks in our eval suite are blocked.

*Status 2026-10-14: live sandbox Payouts verified (gate 1) and live Gemini verified for all three agents (gate AI). Webhook gate waits for a public URL; Invoicing is not built.*
