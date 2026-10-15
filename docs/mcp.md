# The agent door (MCP)

Any MCP client can work with HandOff at:

```
https://agent-two-hand-handoff.onrender.com/api/mcp
```

It speaks MCP 2026-07-28 over stateless Streamable HTTP (2025-era clients are served too). Every request needs the demo bearer token, `Authorization: Bearer <token>`. On Render the token is `HANDOFF_MCP_TOKEN` in the `handoff-shared` environment group; it is generated once and shared with judges in the Devpost testing instructions. It can only propose and read.

## Tools

| Tool | What it does |
|---|---|
| `list_rate_lines` | The active mandate's payees and rate lines, with prices from the creator's signed rate card |
| `propose_task` | Proposes work (payee, rate line, quantity, deliverable spec) as a signed PROPOSAL receipt for the creator's team; at most 20 per hour |
| `get_task_status` | Where a task stands: delivered, verified, decided, paid |
| `list_receipts` | Signed receipts, oldest first, up to 50 per call |
| `verify_chain` | Verifies every signature, link and checkpoint (Ed25519 + ML-DSA-65) now |

There is no tool that pays, approves or changes the mandate, and no tool takes an amount. Every call passes the default-deny gateway with a strict schema: a call with an extra field (such as `amountMinor`) is refused, and so is a call to a tool that does not exist (such as `create_payout`). Each call is logged as a span with its trace id.

## Connect

**MCP Inspector:** run `npx @modelcontextprotocol/inspector`, choose Streamable HTTP, enter the URL above, and add the header `Authorization: Bearer <token>`. To call from the Inspector's browser UI, add its origin (for example `http://localhost:6274`) to `HANDOFF_MCP_ALLOWED_ORIGINS` on Render.

**Claude Desktop, Claude Code, or another client:** add a remote (Streamable HTTP) server with the URL above and the same `Authorization` header. An optional `X-Agent-Name` header labels your proposals in the ledger.

**Raw HTTP:**

```bash
curl -s https://agent-two-hand-handoff.onrender.com/api/mcp -H "Authorization: Bearer $HANDOFF_MCP_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## What a proposal does, and doesn't do

A proposal is checked in code against the active mandate (the payee must be listed, the rate line must exist, the quantity must be within its maximum) and recorded as a signed receipt with the agent's name and trace id. It does not create a task, a decision or a payout. Money moves only after a delivery, an independent verdict and the policy engine, exactly as for work the creator's own ops agent assigns.
