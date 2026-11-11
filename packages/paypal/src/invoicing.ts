/**
 * PayPal Invoicing v2 (sandbox): how a brand's money reaches the creator's own PayPal account.
 * HandOff never holds funds. It sends an invoice, reads its status from PayPal, and records what
 * PayPal reports as a signed receipt.
 */
import type { PayPalClient } from "./client.ts";
import { minorToValue, valueToMinor, type Currency } from "./money.ts";

export interface CreateInvoiceInput {
  /** Idempotency key: a retried create returns the same invoice instead of a second one. */
  requestId: string;
  invoiceNumber: string;
  currency: Currency;
  recipientEmail: string;
  recipientName: string;
  itemName: string;
  itemDescription?: string;
  amountMinor: number;
  note?: string;
  /** Days until the invoice is due. */
  dueInDays?: number;
}

/** The invoice id is the last path segment of the href PayPal returns. */
export function invoiceIdFromHref(href: string): string {
  const id = href.split("/").filter(Boolean).at(-1);
  if (!id || !/^INV2-[A-Z0-9-]+$/.test(id)) throw new Error(`unexpected invoice href: ${href}`);
  return id;
}

/** Creates a draft invoice. Returns its id. */
export async function createInvoice(client: PayPalClient, input: CreateInvoiceInput): Promise<string> {
  const [given, ...rest] = input.recipientName.split(" ");
  const res = await client.request<{ href: string }>("POST", "/v2/invoicing/invoices", {
    requestId: input.requestId,
    body: {
      detail: {
        invoice_number: input.invoiceNumber,
        currency_code: input.currency,
        note: input.note,
        payment_term: { term_type: "NET_10" },
      },
      primary_recipients: [{ billing_info: { name: { given_name: given, surname: rest.join(" ") || "Brand" }, email_address: input.recipientEmail } }],
      items: [
        {
          name: input.itemName,
          description: input.itemDescription,
          quantity: "1",
          unit_amount: { currency_code: input.currency, value: minorToValue(input.amountMinor) },
        },
      ],
      configuration: { allow_tip: false, tax_inclusive: false },
    },
  });
  return invoiceIdFromHref(res.href);
}

/** Sends a draft to the recipient. The invoice then has a payer link. */
export async function sendInvoice(client: PayPalClient, invoiceId: string, subject: string, note: string): Promise<void> {
  await client.request("POST", `/v2/invoicing/invoices/${invoiceId}/send`, {
    requestId: `send-${invoiceId}`,
    body: { subject, note, send_to_invoicer: false, send_to_recipient: true },
  });
}

export interface InvoiceDetails {
  id: string;
  status: string;
  invoiceNumber: string;
  amountMinor: number;
  paidMinor: number;
  /** The page where the brand pays, once the invoice is sent. */
  payerViewUrl?: string;
}

export async function getInvoice(client: PayPalClient, invoiceId: string): Promise<InvoiceDetails> {
  const r = await client.request<{
    id: string;
    status: string;
    detail: { invoice_number: string; metadata?: { recipient_view_url?: string } };
    amount?: { value: string; currency_code: string };
    due_amount?: { value: string };
    payments?: { paid_amount?: { value: string } };
  }>("GET", `/v2/invoicing/invoices/${invoiceId}`);
  return {
    id: r.id,
    status: r.status,
    invoiceNumber: r.detail.invoice_number,
    amountMinor: r.amount ? valueToMinor(r.amount.value) : 0,
    paidMinor: r.payments?.paid_amount ? valueToMinor(r.payments.paid_amount.value) : 0,
    ...(r.detail.metadata?.recipient_view_url ? { payerViewUrl: r.detail.metadata.recipient_view_url } : {}),
  };
}

/** PayPal marks a fully paid invoice PAID (paid on PayPal) or MARKED_AS_PAID (recorded by the invoicer). */
export function isInvoicePaid(d: InvoiceDetails): boolean {
  return (d.status === "PAID" || d.status === "MARKED_AS_PAID") && d.paidMinor > 0 && d.paidMinor >= d.amountMinor;
}

/**
 * Sandbox only: records a payment against an invoice, as an invoicer does for a payment received
 * outside PayPal. No funds move. Used by the demo to stand in for the brand paying.
 */
export async function recordInvoicePayment(client: PayPalClient, invoiceId: string, amountMinor: number, currency: Currency, note: string): Promise<void> {
  await client.request("POST", `/v2/invoicing/invoices/${invoiceId}/payments`, {
    requestId: `pay-${invoiceId}`,
    body: {
      method: "OTHER",
      payment_date: new Date().toISOString().slice(0, 10),
      amount: { currency_code: currency, value: minorToValue(amountMinor) },
      note,
    },
  });
}
