import { describe, expect, it } from "vitest";
import { PayPalClient, PayPalError } from "../src/client.ts";
import { assertSandbox, loadPayPalConfig, SANDBOX_API_BASE } from "../src/config.ts";
import { minorToValue, valueToMinor } from "../src/money.ts";
import { buildPayoutBatchBody, createPayoutBatch } from "../src/payouts.ts";
import { verifyWebhookSignature, WebhookVerificationError } from "../src/webhooks.ts";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<(call: Call) => Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${call.url}`);
    return next(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const token = () => json(200, { access_token: "tok-1", expires_in: 32400 });
const config = { apiBase: SANDBOX_API_BASE, clientId: "id", clientSecret: "secret" };
const quiet = { sleep: async () => {}, log: () => {} };

describe("sandbox guard", () => {
  it.each([
    "https://api-m.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com.evil.example",
    "https://evil.example/api-m.sandbox.paypal.com",
    "not a url",
  ])("refuses %s", (base) => {
    expect(() => assertSandbox(base)).toThrow();
  });

  it("accepts the sandbox host", () => {
    expect(() => assertSandbox("https://api-m.sandbox.paypal.com")).not.toThrow();
  });

  it("refuses to load a live config even when credentials are present", () => {
    expect(() =>
      loadPayPalConfig({ PAYPAL_API_BASE: "https://api-m.paypal.com", PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" }),
    ).toThrow(/sandbox only/);
  });

  it("refuses to construct a client for a live base URL", () => {
    expect(() => new PayPalClient({ ...config, apiBase: "https://api-m.paypal.com" })).toThrow();
  });
});

describe("money", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [4000, "40.00"],
    [15099, "150.99"],
  ])("formats %i cents as %s", (minor, value) => {
    expect(minorToValue(minor)).toBe(value);
    expect(valueToMinor(value)).toBe(minor);
  });

  it.each([-1, 1.5, Number.NaN])("rejects %s cents", (minor) => {
    expect(() => minorToValue(minor)).toThrow(RangeError);
  });

  it.each(["40", "40.5", "40.50"])("parses %s", (value) => {
    expect(valueToMinor(value)).toBe(value === "40" ? 4000 : 4050);
  });

  it.each(["-1.00", "1e3", "40.001", "$40"])("rejects %s", (value) => {
    expect(() => valueToMinor(value)).toThrow(RangeError);
  });
});

describe("PayPalClient", () => {
  it("fetches a token once and reuses it", async () => {
    const f = fakeFetch([token(), () => json(200, { ok: 1 }), () => json(200, { ok: 2 })].map((r) => (typeof r === "function" ? r : () => r)));
    const client = new PayPalClient(config, { fetch: f.impl, ...quiet });
    await client.request("GET", "/a");
    await client.request("GET", "/b");
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(["/v1/oauth2/token", "/a", "/b"]);
    expect((f.calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("retries 503 and 429, honoring Retry-After", async () => {
    const delays: number[] = [];
    const f = fakeFetch([
      () => token(),
      () => json(503, { name: "SERVICE_UNAVAILABLE" }),
      () => json(429, { name: "RATE_LIMIT_REACHED" }, { "retry-after": "2" }),
      () => json(201, { batch_header: { payout_batch_id: "B1" } }),
    ]);
    const client = new PayPalClient(config, { fetch: f.impl, backoffMs: 100, sleep: async (ms) => void delays.push(ms), log: () => {} });
    const res = await client.request<{ batch_header: { payout_batch_id: string } }>("POST", "/v1/payments/payouts", { body: {} });
    expect(res.batch_header.payout_batch_id).toBe("B1");
    expect(delays).toEqual([100, 2000]);
  });

  it("never retries a 4xx and surfaces the debug id", async () => {
    const f = fakeFetch([
      () => token(),
      () => json(422, { name: "UNPROCESSABLE_ENTITY", message: "bad", debug_id: "dbg-9" }, { "paypal-debug-id": "dbg-9" }),
    ]);
    const client = new PayPalClient(config, { fetch: f.impl, ...quiet });
    const err = await client.request("POST", "/v1/payments/payouts", { body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).status).toBe(422);
    expect((err as PayPalError).debugId).toBe("dbg-9");
    expect(f.calls).toHaveLength(2);
  });
});

describe("Payouts", () => {
  const input = {
    senderBatchId: "pr-2026w45-5d1e9a",
    emailSubject: "You have a payout from Maya's studio",
    items: [
      { receiverEmail: "theo@example.com", amountMinor: 4000, currency: "USD" as const, senderItemId: "dec-15" },
      { receiverEmail: "ana@example.com", amountMinor: 15000, currency: "USD" as const, senderItemId: "dec-18" },
    ],
  };

  it("builds the batch body with decimal amounts", () => {
    const body = buildPayoutBatchBody(input);
    expect(body.sender_batch_header.sender_batch_id).toBe("pr-2026w45-5d1e9a");
    expect(body.items.map((i) => i.amount)).toEqual([
      { value: "40.00", currency: "USD" },
      { value: "150.00", currency: "USD" },
    ]);
    expect(body.items.every((i) => i.recipient_type === "EMAIL")).toBe(true);
  });

  it("sends the batch id as PayPal-Request-Id", async () => {
    const f = fakeFetch([() => token(), () => json(201, { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } })]);
    const client = new PayPalClient(config, { fetch: f.impl, ...quiet });
    await createPayoutBatch(client, input);
    const headers = f.calls[1]!.init.headers as Record<string, string>;
    expect(headers["PayPal-Request-Id"]).toBe("pr-2026w45-5d1e9a");
  });

  it("rejects duplicate item ids, overlong ids, empty batches and Venmo without a note", () => {
    expect(() => buildPayoutBatchBody({ ...input, items: [input.items[0]!, input.items[0]!] })).toThrow(/duplicate/);
    expect(() => buildPayoutBatchBody({ ...input, items: [{ ...input.items[0]!, senderItemId: "x".repeat(64) }] })).toThrow(/longer/);
    expect(() => buildPayoutBatchBody({ ...input, items: [] })).toThrow(/at least one/);
    expect(() => buildPayoutBatchBody({ ...input, items: [{ ...input.items[0]!, recipientWallet: "VENMO" }] })).toThrow(/note/);
  });
});

describe("webhook verification", () => {
  const headers: Record<string, string> = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
    "paypal-transmission-id": "t-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-06T18:00:00Z",
  };
  const rawBody = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item_id: "I1" } });

  it("returns the event when PayPal reports SUCCESS", async () => {
    const f = fakeFetch([() => token(), () => json(200, { verification_status: "SUCCESS" })]);
    const client = new PayPalClient(config, { fetch: f.impl, ...quiet });
    const event = await verifyWebhookSignature(client, { header: (n) => headers[n], rawBody, webhookId: "WHID" });
    expect(event.id).toBe("WH-1");
    const sent = JSON.parse(String(f.calls[1]!.init.body)) as { webhook_id: string; transmission_id: string };
    expect(sent.webhook_id).toBe("WHID");
    expect(sent.transmission_id).toBe("t-1");
  });

  it("rejects FAILURE and missing headers", async () => {
    const f = fakeFetch([() => token(), () => json(200, { verification_status: "FAILURE" })]);
    const client = new PayPalClient(config, { fetch: f.impl, ...quiet });
    await expect(verifyWebhookSignature(client, { header: (n) => headers[n], rawBody, webhookId: "W" })).rejects.toThrow(
      WebhookVerificationError,
    );
    await expect(verifyWebhookSignature(client, { header: () => undefined, rawBody, webhookId: "W" })).rejects.toThrow(/missing/);
  });
});
