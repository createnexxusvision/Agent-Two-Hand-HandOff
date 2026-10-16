/**
 * MCP gate: drive the live agent door with a real MCP client.
 * Needs HANDOFF_MCP_TOKEN; HANDOFF_MCP_URL defaults to the Render deployment.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

try {
  process.loadEnvFile();
} catch {
  // No .env file; use the environment as is.
}
const token = process.env.HANDOFF_MCP_TOKEN?.trim();
const url = new URL(process.env.HANDOFF_MCP_URL ?? "https://agent-two-hand-handoff.onrender.com/api/mcp");
if (!token) {
  console.log("Gate MCP: PENDING. Set HANDOFF_MCP_TOKEN.");
  process.exit(2);
}

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);
const text = (r: { content?: unknown }) => ((r.content as { text?: string }[] | undefined)?.[0]?.text ?? "");

async function connect(withToken: boolean) {
  const headers: Record<string, string> = { "x-agent-name": "gate-mcp" };
  if (withToken) headers.authorization = `Bearer ${token}`;
  const client = new Client({ name: "handoff-gate", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
  return client;
}

const refused = await connect(false).then(
  async (c) => (await c.close(), false),
  () => true,
);
check("no token is refused", refused);

const client = await connect(true);
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check("exactly five propose-only tools", names.join(",") === "get_task_status,list_rate_lines,list_receipts,propose_task,verify_chain", names.join(", "));

const card = JSON.parse(text(await client.callTool({ name: "list_rate_lines", arguments: {} })));
check("list_rate_lines reads the active mandate", card.active === true, card.mandateId ?? card.note);

const spec = { deliverable: "Captions for the launch video", aspect: null, maxDurationS: null, minWidth: null, fileCount: null };
if (card.active) {
  const p = await client.callTool({ name: "propose_task", arguments: { payeeId: "sam", rateLineId: "caption-v1", quantity: 1, spec } });
  const out = p.isError ? null : JSON.parse(text(p));
  check("propose_task records a signed proposal", Boolean(out?.receiptSeq), out ? `${out.proposalId}, receipt #${out.receiptSeq}` : text(p));
}

const withAmount = await client.callTool({ name: "propose_task", arguments: { payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1, spec, amountMinor: 500000 } });
check("an amount field is refused", withAmount.isError === true);

const payout = await client.callTool({ name: "create_payout", arguments: { to: "x@example.com", amount: 5000 } }).then(
  (r) => r.isError === true,
  () => true,
);
check("create_payout does not exist", payout);

const receipts = JSON.parse(text(await client.callTool({ name: "list_receipts", arguments: { fromSeq: 1, limit: 50 } }))) as { type: string; body: { taskId?: string; status?: string } }[];
check("list_receipts pages the ledger", receipts.length > 0, `${receipts.length} receipts`);
const blocked = receipts.find((r) => r.type === "DECISION" && r.body.status === "BLOCKED")?.body.taskId;
if (blocked) {
  const s = JSON.parse(text(await client.callTool({ name: "get_task_status", arguments: { taskId: blocked } })));
  check("get_task_status explains a blocked task", s.decision?.status === "BLOCKED", `${blocked}: ${s.decision?.blockedBy}`);
}

const v = JSON.parse(text(await client.callTool({ name: "verify_chain", arguments: {} })));
check("verify_chain passes", v.ok === true, `${v.receiptsChecked} receipts; checkpoint ${v.latestCheckpoint?.treeSize ?? "none"}`);
await client.close();

for (const [name, ok, detail] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `Gate MCP: FAIL (${failed})` : `Gate MCP: PASS (${results.length} checks)`);
process.exitCode = failed ? 1 : 0;
