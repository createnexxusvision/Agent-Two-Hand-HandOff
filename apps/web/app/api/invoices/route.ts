import { EngineError } from "@handoff/engine";
import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const back = (msg: string) => new Response(null, { status: 303, headers: { Location: `/?msg=${encodeURIComponent(msg)}#invoices` } });

/**
 * Brand money in, through PayPal Invoicing (sandbox).
 * choice=create: invoice the demo brand. choice=pay&invoiceId=…: record the brand's payment (sandbox stand-in).
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const { engine } = await getEngine();
    if (form.get("choice") === "pay") {
      const id = String(form.get("invoiceId") ?? "").slice(0, 64);
      const recorded = await engine.simulateBrandPayment(id);
      return back(
        recorded > 0
          ? "PayPal reports the invoice paid. The payment is now a signed receipt."
          : "Payment recorded with PayPal. The income receipt appears when PayPal's signed webhook arrives (or after a status read, within about two minutes); this page refreshes itself.",
      );
    }
    const { invoiceNumber } = await engine.createBrandInvoice();
    return back(`Invoice ${invoiceNumber} sent through PayPal Invoicing. Record the brand's payment below, or pay it from the sandbox account that received it.`);
  } catch (e) {
    if (e instanceof EngineError) return back(e.message);
    console.error(e);
    return back("PayPal Invoicing could not complete that. Check the server log.");
  }
}
