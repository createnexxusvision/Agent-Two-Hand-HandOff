import { assertSandbox, type PayPalConfig } from "./config.ts";

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string | undefined,
    message: string,
    readonly debugId: string | undefined,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export interface RequestOptions {
  body?: unknown;
  /** Sent as PayPal-Request-Id so PayPal can deduplicate retried POSTs. */
  requestId?: string;
  headers?: Record<string, string>;
}

export interface PayPalClientOptions {
  fetch?: typeof fetch;
  maxRetries?: number;
  /** Base delay for exponential backoff, in ms. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class PayPalClient {
  private token: CachedToken | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(
    readonly config: PayPalConfig,
    options: PayPalClientOptions = {},
  ) {
    assertSandbox(config.apiBase);
    this.fetchImpl = options.fetch ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffMs = options.backoffMs ?? 500;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(line));
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_EXPIRY_MARGIN_MS > this.now()) return this.token.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await this.send(`${this.config.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: this.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, options: RequestOptions = {}): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
    const res = await this.send(`${this.config.apiBase}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Retries 429 and 5xx with backoff (honoring Retry-After). Never retries other 4xx. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, init);
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) throw await toError(res, this.log);
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoffMs * 2 ** attempt;
      this.log(`PayPal ${res.status} on ${init.method} ${new URL(url).pathname}; retrying in ${delay} ms`);
      await this.sleep(delay);
    }
  }
}

async function toError(res: Response, log: (line: string) => void): Promise<PayPalError> {
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  let body: { name?: string; message?: string; error?: string; error_description?: string; debug_id?: string; details?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Non-JSON error bodies carry nothing we need.
  }
  const id = debugId ?? body.debug_id;
  const message = body.message ?? body.error_description ?? `PayPal request failed with ${res.status}`;
  log(`PayPal error ${res.status} ${body.name ?? body.error ?? ""} debug_id=${id ?? "none"}: ${message}`);
  return new PayPalError(res.status, body.name ?? body.error, message, id, body.details);
}
