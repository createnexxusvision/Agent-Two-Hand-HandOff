/**
 * Gate 2: receive a real sandbox payout webhook and verify it through PayPal.
 *
 * 1. Run this on a public URL (Render, or a tunnel to PORT, default 8787).
 * 2. In the PayPal developer dashboard, add a webhook pointing at <url>/api/webhooks/paypal
 *    for the Payouts events, and put its id in PAYPAL_WEBHOOK_ID.
 * 3. Run gate 1 to create a payout. Simulator events cannot pass verification; real ones can.
 */
import { createServer } from "node:http";
import { loadPayPalConfig, PayPalClient, verifyWebhookSignature, WebhookVerificationError } from "@handoff/paypal";

try {
  process.loadEnvFile();
} catch {
  // No .env file; use the environment as is.
}

const config = loadPayPalConfig();
if (!config.webhookId) {
  console.log("Gate 2: PENDING. Set PAYPAL_WEBHOOK_ID to the sandbox webhook's id.");
  process.exit(2);
}
const client = new PayPalClient(config);
const port = Number(process.env.PORT ?? 8787);
const seen = new Set<string>();

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/webhooks/paypal") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");
    try {
      const event = await verifyWebhookSignature(client, {
        header: (name) => {
          const v = req.headers[name];
          return Array.isArray(v) ? v[0] : v;
        },
        rawBody,
        webhookId: config.webhookId!,
      });
      const duplicate = seen.has(event.id);
      seen.add(event.id);
      console.log(`PASS  ${event.event_type} ${event.id} verified${duplicate ? " (duplicate delivery, ignored)" : ""}`);
      res.writeHead(200).end();
    } catch (e) {
      const why = e instanceof WebhookVerificationError ? e.message : String(e);
      console.log(`FAIL  webhook rejected: ${why}`);
      res.writeHead(e instanceof WebhookVerificationError ? 400 : 500).end();
    }
  });
}).listen(port, () => console.log(`Gate 2 listening on :${port}/api/webhooks/paypal`));
