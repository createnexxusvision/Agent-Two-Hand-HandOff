/**
 * The checks in front of the MCP handler, which itself verifies no token and no Origin.
 * A bearer token gates every request; browser requests from unlisted origins are refused, which
 * blocks DNS-rebinding and cross-site calls; with no token configured the door is closed.
 */
import { timingSafeEqual } from "node:crypto";

export type DoorConfig = {
  /** The bearer token clients must send. Unset: the endpoint answers 503. */
  token?: string;
  /** Origins allowed to call from a browser, e.g. the MCP Inspector. Non-browser clients send none. */
  allowedOrigins?: readonly string[];
};

export type DoorResult = { ok: true; authInfo: { token: string; clientId: string; scopes: string[] } } | { ok: false; response: Response };

const deny = (status: number, message: string, extra: Record<string, string> = {}) => ({
  ok: false as const,
  response: new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json", ...extra } }),
});

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkDoor(request: Request, config: DoorConfig): DoorResult {
  if (!config.token) return deny(503, "The MCP door is closed on this deployment (no HANDOFF_MCP_TOKEN).");
  const origin = request.headers.get("origin");
  if (origin && !(config.allowedOrigins ?? []).includes(origin)) return deny(403, `Origin ${origin} is not allowed.`);
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !sameSecret(match[1]!, config.token)) {
    return deny(401, "Missing or invalid bearer token.", { "www-authenticate": 'Bearer realm="handoff-mcp"' });
  }
  const agent = request.headers.get("x-agent-name")?.trim().slice(0, 64);
  return { ok: true, authInfo: { token: match[1]!, clientId: agent ? `demo-token:${agent}` : "demo-token", scopes: ["propose", "read"] } };
}
