import { describe, expect, it } from "vitest";
import { invoiceIdFromHref, isInvoicePaid, type InvoiceDetails } from "../src/invoicing.ts";

const invoice = (over: Partial<InvoiceDetails>): InvoiceDetails => ({ id: "INV2-X", status: "SENT", invoiceNumber: "1", amountMinor: 50000, paidMinor: 0, ...over });

describe("PayPal Invoicing helpers", () => {
  it("takes the invoice id from PayPal's href and refuses anything else", () => {
    expect(invoiceIdFromHref("https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-1234-WXYZ")).toBe("INV2-ABCD-1234-WXYZ");
    expect(() => invoiceIdFromHref("https://api.sandbox.paypal.com/v2/invoicing/invoices/../../v1/payments")).toThrow(/unexpected invoice href/);
  });

  it("counts an invoice as paid only when PayPal says so and the full amount arrived", () => {
    expect(isInvoicePaid(invoice({ status: "PAID", paidMinor: 50000 }))).toBe(true);
    expect(isInvoicePaid(invoice({ status: "MARKED_AS_PAID", paidMinor: 50000 }))).toBe(true);
    expect(isInvoicePaid(invoice({ status: "SENT" }))).toBe(false);
    expect(isInvoicePaid(invoice({ status: "PARTIALLY_PAID", paidMinor: 20000 }))).toBe(false);
    expect(isInvoicePaid(invoice({ status: "PAID", paidMinor: 20000 }))).toBe(false);
    expect(isInvoicePaid(invoice({ status: "PAID", paidMinor: 0 }))).toBe(false);
  });
});
