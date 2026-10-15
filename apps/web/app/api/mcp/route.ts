import { checkDoor, createHandoffMcpHandler } from "@handoff/mcp";
import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";

// One handler per process; it builds a fresh, stateless MCP server for every request.
const handler = createHandoffMcpHandler({
  getEngine: async () => (await getEngine()).engine,
  onSpan: (span) => console.log(JSON.stringify({ mcp: span })),
});

const allowedOrigins = (process.env.HANDOFF_MCP_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

async function serve(request: Request): Promise<Response> {
  const door = checkDoor(request, { token: process.env.HANDOFF_MCP_TOKEN?.trim(), allowedOrigins });
  if (!door.ok) return door.response;
  return handler.fetch(request, { authInfo: door.authInfo });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
