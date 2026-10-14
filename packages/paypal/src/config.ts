export const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";
const SANDBOX_HOST = "api-m.sandbox.paypal.com";

export interface PayPalConfig {
  apiBase: string;
  clientId: string;
  clientSecret: string;
  webhookId?: string;
}

/** Throws unless the base URL is the PayPal sandbox. This project never talks to live PayPal. */
export function assertSandbox(apiBase: string): void {
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    throw new Error(`PAYPAL_API_BASE is not a valid URL: ${apiBase}`);
  }
  if (url.protocol !== "https:" || url.hostname !== SANDBOX_HOST || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`Refusing PayPal base URL ${apiBase}: only ${SANDBOX_API_BASE} is allowed (sandbox only).`);
  }
}

export function loadPayPalConfig(env: NodeJS.ProcessEnv = process.env): PayPalConfig {
  const apiBase = env.PAYPAL_API_BASE?.trim() || SANDBOX_API_BASE;
  assertSandbox(apiBase);
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (sandbox app credentials).");
  }
  const webhookId = env.PAYPAL_WEBHOOK_ID?.trim() || undefined;
  return { apiBase: apiBase.replace(/\/$/, ""), clientId, clientSecret, webhookId };
}
