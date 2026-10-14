/**
 * PayPal Payouts (sandbox). Only packages/policy/src/execute.ts may import this module;
 * ESLint and tests/architecture.test.ts enforce that.
 */
import type { PayPalClient } from "./client.ts";
import { minorToValue, type Currency } from "./money.ts";

/**
 * Sandbox-only test values from https://developer.paypal.com/api/payouts/test-go-live/ (checked 2026-10-13).
 * PayPal-Mock-Response is not supported by Payouts; these values are.
 */
export const PAYOUTS_TEST_VALUES = {
  /** Put in items[0].note on create: the batch fails with INSUFFICIENT_FUNDS. */
  insufficientFundsNote: "ERRPYO005",
  /** Put in items[0].note on create with a Venmo recipient: a successful Venmo payout. */
  venmoSuccessNote: "POSPYO003",
  /** Use as the item id on lookup: RECEIVER_UNREGISTERED. */
  receiverUnregisteredItemId: "ERRPYO047",
  /** Use as the batch id on lookup: a DENIED batch. */
  deniedBatchId: "ERRPYOB004",
} as const;

export interface PayoutItemInput {
  receiverEmail: string;
  amountMinor: number;
  currency: Currency;
  /** Unique within the batch; at most 63 characters. */
  senderItemId: string;
  note?: string;
  recipientWallet?: "PAYPAL" | "VENMO";
}

export interface CreatePayoutBatchInput {
  /** Idempotency key. PayPal rejects a reused id for 30 days. Derive it from the approved decisions. */
  senderBatchId: string;
  emailSubject: string;
  emailMessage?: string;
  items: PayoutItemInput[];
}

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: string;
  sender_batch_header: { sender_batch_id: string; email_subject?: string };
  time_created?: string;
  amount?: { currency: string; value: string };
  fees?: { currency: string; value: string };
}

export interface PayoutItemDetails {
  payout_item_id: string;
  transaction_status?: string;
  transaction_id?: string;
  payout_batch_id: string;
  payout_item: {
    receiver: string;
    sender_item_id: string;
    amount: { currency: string; value: string };
    recipient_wallet?: string;
    note?: string;
  };
  errors?: { name?: string; message?: string };
  time_processed?: string;
}

export interface PayoutBatch {
  batch_header: PayoutBatchHeader;
  items?: PayoutItemDetails[];
}

const MAX_SENDER_ITEM_ID = 63;

export function buildPayoutBatchBody(input: CreatePayoutBatchInput) {
  if (input.items.length === 0) throw new Error("a payout batch needs at least one item");
  if (input.items.length > 15_000) throw new Error("PayPal allows at most 15,000 items per batch");
  const seen = new Set<string>();
  const items = input.items.map((item) => {
    if (item.senderItemId.length > MAX_SENDER_ITEM_ID) throw new Error(`sender_item_id longer than ${MAX_SENDER_ITEM_ID}`);
    if (seen.has(item.senderItemId)) throw new Error(`duplicate sender_item_id ${item.senderItemId}`);
    seen.add(item.senderItemId);
    if (item.recipientWallet === "VENMO" && !item.note) throw new Error("Venmo payouts require a note");
    return {
      recipient_type: "EMAIL",
      receiver: item.receiverEmail,
      amount: { value: minorToValue(item.amountMinor), currency: item.currency },
      sender_item_id: item.senderItemId,
      ...(item.note ? { note: item.note } : {}),
      ...(item.recipientWallet ? { recipient_wallet: item.recipientWallet } : {}),
    };
  });
  return {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      email_subject: input.emailSubject,
      ...(input.emailMessage ? { email_message: input.emailMessage } : {}),
    },
    items,
  };
}

export async function createPayoutBatch(client: PayPalClient, input: CreatePayoutBatchInput): Promise<PayoutBatch> {
  return client.request<PayoutBatch>("POST", "/v1/payments/payouts", {
    body: buildPayoutBatchBody(input),
    requestId: input.senderBatchId,
  });
}

export async function getPayoutBatch(client: PayPalClient, payoutBatchId: string): Promise<PayoutBatch> {
  return client.request<PayoutBatch>("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
}

export async function getPayoutItem(client: PayPalClient, payoutItemId: string): Promise<PayoutItemDetails> {
  return client.request<PayoutItemDetails>("GET", `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}`);
}

/** Only UNCLAIMED items can be cancelled; the money returns to the sender. */
export async function cancelUnclaimedItem(client: PayPalClient, payoutItemId: string): Promise<PayoutItemDetails> {
  return client.request<PayoutItemDetails>("POST", `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}/cancel`);
}
