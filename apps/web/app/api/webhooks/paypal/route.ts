import { EngineError } from "@handoff/engine";
import { WebhookVerificationError } from "@handoff/paypal";
import { getEngine } from "../../../../lib/engine";

export const dynamic = "force-dynamic";

/** PayPal webhook receiver. Every event is verified with PayPal before anything is recorded. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const { engine } = await getEngine();
    const result = await engine.handleWebhook(rawBody, (name) => request.headers.get(name));
    return Response.json({ result });
  } catch (e) {
    if (e instanceof WebhookVerificationError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof EngineError) return Response.json({ error: e.message }, { status: e.code === "NOT_CONFIGURED" ? 503 : 409 });
    console.error(e);
    // A 5xx makes PayPal retry later (up to 25 times over 3 days).
    return Response.json({ error: "temporary failure" }, { status: 500 });
  }
}
