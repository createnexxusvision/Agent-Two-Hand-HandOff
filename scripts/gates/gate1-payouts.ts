/**
 * Gate 1 (must pass): PayPal OAuth and Payouts in the sandbox.
 *
 * Needs, in .env or the environment (sandbox values only):
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET   sandbox app with Payouts enabled
 *   GATE_PAYEE_EMAIL_1, GATE_PAYEE_EMAIL_2   two sandbox personal accounts
 *
 * Checks: a 2-item batch returns 201; the batch lookup lists both items; reusing the
 * sender_batch_id is rejected; the ERRPYO005 test value produces INSUFFICIENT_FUNDS.
 * This script is the one sanctioned direct caller of Payouts outside packages/policy.
 */
import { loadPayPalConfig, PayPalClient, PayPalError } from "@handoff/paypal";
import { createPayoutBatch, getPayoutBatch, PAYOUTS_TEST_VALUES, type PayoutBatch } from "@handoff/paypal/payouts";

try {
  process.loadEnvFile();
} catch {
  // No .env file; use the environment as is.
}

const payees = [process.env.GATE_PAYEE_EMAIL_1, process.env.GATE_PAYEE_EMAIL_2];
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET || payees.some((p) => !p)) {
  console.log("Gate 1: PENDING. Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GATE_PAYEE_EMAIL_1 and GATE_PAYEE_EMAIL_2 (sandbox).");
  process.exit(2);
}

const client = new PayPalClient(loadPayPalConfig());
const results: [string, boolean, string?][] = [];
const runId = `gate1-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  await client.accessToken();
  results.push(["OAuth client-credentials token", true]);

  const created = await createPayoutBatch(client, {
    senderBatchId: runId,
    emailSubject: "HandOff gate test",
    items: payees.map((email, i) => ({ receiverEmail: email!, amountMinor: 100, currency: "USD" as const, senderItemId: `${runId}-${i + 1}` })),
  });
  const batchId = created.batch_header.payout_batch_id;
  results.push(["2-item batch accepted", Boolean(batchId), `payout_batch_id ${batchId}, status ${created.batch_header.batch_status}`]);

  let batch: PayoutBatch = created;
  for (let i = 0; i < 12 && ["PENDING", "PROCESSING"].includes(batch.batch_header.batch_status); i++) {
    await sleep(5000);
    batch = await getPayoutBatch(client, batchId);
  }
  const statuses = (batch.items ?? []).map((it) => it.transaction_status ?? "?");
  results.push(["batch lookup lists both items", (batch.items ?? []).length === 2, `batch ${batch.batch_header.batch_status}; items ${statuses.join(", ")}`]);

  const replay = await createPayoutBatch(client, {
    senderBatchId: runId,
    emailSubject: "HandOff gate test (replay)",
    items: [{ receiverEmail: payees[0]!, amountMinor: 100, currency: "USD", senderItemId: `${runId}-replay` }],
  }).then(
    (b) => ({ rejected: b.batch_header.payout_batch_id === batchId, detail: `returned ${b.batch_header.payout_batch_id}` }),
    (e: unknown) => ({ rejected: e instanceof PayPalError, detail: e instanceof PayPalError ? `${e.status} ${e.errorName}` : String(e) }),
  );
  results.push(["reused sender_batch_id does not pay twice", replay.rejected, replay.detail]);

  const negative = await createPayoutBatch(client, {
    senderBatchId: `${runId}-neg`,
    emailSubject: "HandOff gate test (negative)",
    items: [{ receiverEmail: payees[0]!, amountMinor: 100, currency: "USD", senderItemId: `${runId}-neg-1`, note: PAYOUTS_TEST_VALUES.insufficientFundsNote }],
  }).then(
    (b) => ({ ok: false, detail: `unexpected success ${b.batch_header.batch_status}` }),
    (e: unknown) => ({ ok: e instanceof PayPalError && /INSUFFICIENT_FUNDS/i.test(`${e.errorName} ${e.message}`), detail: e instanceof PayPalError ? `${e.status} ${e.errorName}` : String(e) }),
  );
  results.push(["ERRPYO005 test value gives INSUFFICIENT_FUNDS", negative.ok, negative.detail]);
} catch (e) {
  results.push(["unexpected error", false, e instanceof PayPalError ? `${e.status} ${e.errorName} debug_id=${e.debugId}: ${e.message}` : String(e)]);
}

for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `Gate 1: FAIL (${failed})` : "Gate 1: PASS");
process.exitCode = failed ? 1 : 0;
