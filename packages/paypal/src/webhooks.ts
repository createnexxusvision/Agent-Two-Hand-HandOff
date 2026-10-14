import type { PayPalClient } from "./client.ts";

/** Payouts spells CANCELED with one L; Invoicing spells CANCELLED with two. */
export const PAYOUT_ITEM_EVENTS = [
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
] as const;

export const PAYOUT_BATCH_EVENTS = [
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.DENIED",
] as const;

export const INVOICE_EVENTS = ["INVOICING.INVOICE.PAID", "INVOICING.INVOICE.CANCELLED"] as const;

export const SUBSCRIBED_EVENTS = [...PAYOUT_ITEM_EVENTS, ...PAYOUT_BATCH_EVENTS, ...INVOICE_EVENTS];

export interface WebhookEvent<R = unknown> {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  resource: R;
  summary?: string;
}

const REQUIRED_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

export type HeaderLookup = (name: string) => string | null | undefined;

export class WebhookVerificationError extends Error {}

/**
 * Verifies a webhook through PayPal's postback endpoint. Events sent from the dashboard's
 * webhook simulator cannot be verified this way; only real sandbox events can.
 */
export async function verifyWebhookSignature(
  client: PayPalClient,
  input: { header: HeaderLookup; rawBody: string; webhookId: string },
): Promise<WebhookEvent> {
  const values: Record<string, string> = {};
  for (const name of REQUIRED_HEADERS) {
    const v = input.header(name);
    if (!v) throw new WebhookVerificationError(`missing ${name} header`);
    values[name] = v;
  }
  let event: WebhookEvent;
  try {
    event = JSON.parse(input.rawBody) as WebhookEvent;
  } catch {
    throw new WebhookVerificationError("webhook body is not JSON");
  }
  const result = await client.request<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    body: {
      auth_algo: values["paypal-auth-algo"],
      cert_url: values["paypal-cert-url"],
      transmission_id: values["paypal-transmission-id"],
      transmission_sig: values["paypal-transmission-sig"],
      transmission_time: values["paypal-transmission-time"],
      webhook_id: input.webhookId,
      webhook_event: event,
    },
  });
  if (result.verification_status !== "SUCCESS") {
    throw new WebhookVerificationError(`webhook signature status ${result.verification_status}`);
  }
  return event;
}
