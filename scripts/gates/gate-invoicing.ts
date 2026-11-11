/**
 * pnpm gate:invoicing: PayPal Invoicing against the real sandbox, through the engine. Sends one
 * invoice to the demo brand email, records the brand's payment, and checks the INCOME receipt.
 * Runs on an embedded database, so the live site's ledger is untouched. Sandbox money only.
 */
import { bootEngine } from "../../packages/engine/src/index.ts";

try {
  process.loadEnvFile();
} catch {
  // No .env file; use the environment as is.
}
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "", PAYPAL_WEBHOOK_ID: "" };
if (!env.PAYPAL_CLIENT_ID || !(env.INVOICE_BRAND_EMAIL || env.GATE_PAYEE_EMAIL_2)) {
  console.log("Gate invoicing: PENDING. Needs PayPal sandbox credentials and GATE_PAYEE_EMAIL_2 (or INVOICE_BRAND_EMAIL).");
  process.exit(2);
}
const { engine } = await bootEngine(env);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);

await engine.createDemoMandate();
const sent = await engine.createBrandInvoice();
check("invoice created and sent through PayPal", /^INV2-/.test(sent.invoiceId), `${sent.invoiceNumber} ${sent.invoiceId}`);
check("payer link returned by PayPal", Boolean(sent.payerViewUrl), sent.payerViewUrl ? new URL(sent.payerViewUrl).host : "none");
check("unpaid invoice records nothing", (await engine.syncInvoices({ immediate: true })) === 0);

const recorded = await engine.simulateBrandPayment(sent.invoiceId);
check("PayPal reports it paid and one receipt is written", recorded === 1);
check("reading again writes no second receipt", (await engine.syncInvoices({ immediate: true })) === 0);

const { receipts } = await engine.view();
const income = receipts.find((r) => r.type === "INCOME");
check("INCOME receipt for $500.00, signed by the status reader", income?.body.paidMinor === 50000 && income.actor === "webhook-handler", `receipt #${income?.seq}`);
const report = await engine.report();
check("ledger verifies with the new receipt types", report.ok, `${report.chain.checked} receipts`);

for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `Gate invoicing: FAIL (${failed})` : `Gate invoicing: PASS (${results.length} checks)`);
process.exitCode = failed ? 1 : 0;
