import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { migrate, openPglite, Store, type Db } from "@handoff/db";
import { Engine, LOCAL_DEMO_SEED, serverSigners } from "@handoff/engine";
import { checkDoor } from "../src/door.ts";
import { createHandoffMcpHandler, MCP_TOOLS } from "../src/server.ts";

const TOKEN = "test-door-token-0123456789";
let db: Db;
let schemaCount = 0;
let engine: Engine;
let clock = new Date("2026-10-16T16:00:00.000Z");
let handler: ReturnType<typeof createHandoffMcpHandler>;
let client: Client;
const spans: { tool: string; ok: boolean }[] = [];

/** Same order as the deployed route: the door first, then the MCP handler. */
async function serve(request: Request): Promise<Response> {
  const door = checkDoor(request, { token: TOKEN, allowedOrigins: ["https://inspector.example"] });
  if (!door.ok) return door.response;
  return handler.fetch(request, { authInfo: door.authInfo });
}

async function connect(headers: Record<string, string> = { authorization: `Bearer ${TOKEN}`, "x-agent-name": "test-agent" }) {
  const transport = new StreamableHTTPClientTransport(new URL("http://handoff.test/api/mcp"), {
    fetch: (url, init) => {
      const merged = new Headers(init?.headers);
      for (const [k, v] of Object.entries(headers)) merged.set(k, v);
      return serve(new Request(url, { ...init, headers: merged }));
    },
  });
  const c = new Client({ name: "test-harness", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(transport);
  return c;
}

const text = (r: { content?: unknown }) => ((r.content as { type: string; text: string }[])[0]?.text ?? "");

beforeAll(async () => {
  db = await openPglite();
}, 60_000);
afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  clock = new Date("2026-10-16T16:00:00.000Z");
  await db.exec(`create schema m${++schemaCount}; set search_path to m${schemaCount}`);
  await migrate(db);
  engine = new Engine({
    store: new Store(db),
    signers: serverSigners(LOCAL_DEMO_SEED),
    masterKey: new Uint8Array(32).fill(7),
    payeeEmails: {},
    useAi: false,
    now: () => clock,
    log: () => {},
    mcpProposalsPerHour: 3,
  });
  await engine.bootstrap();
  await engine.startDemoWeek();
  handler = createHandoffMcpHandler({ getEngine: async () => engine, onSpan: (s) => spans.push({ tool: s.tool, ok: s.ok }) });
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await handler.close();
});

describe("the MCP agent door", () => {
  it("offers exactly the five propose-only tools, and no way to pay", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOLS].sort());
    expect(tools.some((t) => /pay|payout|approve|amount/i.test(t.name))).toBe(false);
    const propose = tools.find((t) => t.name === "propose_task")!;
    expect(JSON.stringify(propose.inputSchema)).not.toMatch(/amount/i);
  });

  it("reads the active rate card", async () => {
    const r = await client.callTool({ name: "list_rate_lines", arguments: {} });
    const card = JSON.parse(text(r));
    expect(card.active).toBe(true);
    expect(card.rateLines.map((l: { id: string; price: string }) => `${l.id}=${l.price}`)).toEqual([
      "short-edit-v1=$40.00",
      "thumb-pack-v1=$150.00",
      "caption-v1=$15.00",
    ]);
  });

  it("records a valid proposal as a signed receipt, with the agent's name and no amount", async () => {
    const spec = { deliverable: "Captions for the launch video", aspect: null, maxDurationS: null, minWidth: null, fileCount: null };
    const r = await client.callTool({ name: "propose_task", arguments: { payeeId: "sam", rateLineId: "caption-v1", quantity: 2, spec } });
    expect(r.isError).toBeFalsy();
    const out = JSON.parse(text(r));
    expect(out).toMatchObject({ status: "pending creator review" });
    const receipt = (await engine.listReceipts(out.receiptSeq, 1))[0]!;
    expect(receipt).toMatchObject({ type: "PROPOSAL", actor: "assistant" });
    expect(receipt.body).toMatchObject({ via: "mcp", agent: "demo-token:test-agent", payeeId: "sam", rateLineId: "caption-v1", quantity: 2 });
    expect(JSON.stringify(receipt.body)).not.toMatch(/amount/i);
    const decisionsBefore = (await engine.view()).view.decisions.size;
    expect(decisionsBefore).toBe(4);
  });

  it("refuses a proposal that carries an amount", async () => {
    const spec = { deliverable: "x", aspect: null, maxDurationS: null, minWidth: null, fileCount: null };
    const r = await client.callTool({ name: "propose_task", arguments: { payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1, spec, amountMinor: 500_000 } });
    expect(r.isError).toBe(true);
    const proposals = (await engine.listReceipts(1, 50)).filter((x) => x.type === "PROPOSAL" && x.body.via === "mcp");
    expect(proposals).toHaveLength(0);
  });

  it("refuses an unknown payee or rate line with a plain reason", async () => {
    const spec = { deliverable: "x", aspect: null, maxDurationS: null, minWidth: null, fileCount: null };
    const r = await client.callTool({ name: "propose_task", arguments: { payeeId: "mallory", rateLineId: "rush-fee", quantity: 1, spec } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/mallory is not a payee.*rush-fee is not a rate line/);
  });

  it("has no payout tool to call", async () => {
    const r = await client.callTool({ name: "create_payout", arguments: { to: "x@example.com", amount: 5000 } }).catch((e: unknown) => e);
    const failed = r instanceof Error || (r as { isError?: boolean }).isError === true;
    expect(failed).toBe(true);
  });

  it("rate-limits proposals", async () => {
    const spec = { deliverable: "x", aspect: null, maxDurationS: null, minWidth: null, fileCount: null };
    const args = { payeeId: "sam", rateLineId: "caption-v1", quantity: 1, spec };
    for (let i = 0; i < 3; i++) expect((await client.callTool({ name: "propose_task", arguments: args })).isError).toBeFalsy();
    const fourth = await client.callTool({ name: "propose_task", arguments: args });
    expect(fourth.isError).toBe(true);
    expect(text(fourth)).toMatch(/too many proposals/);
  });

  it("reports task status and verifies the chain", async () => {
    const receipts = await engine.listReceipts(1, 50);
    const blockedTask = receipts.find((r) => r.type === "DECISION" && r.body.status === "BLOCKED")!.body.taskId as string;
    const status = JSON.parse(text(await client.callTool({ name: "get_task_status", arguments: { taskId: blockedTask } })));
    expect(status).toMatchObject({ delivered: true, verdict: { pass: false }, decision: { status: "BLOCKED", blockedBy: "verdict_pass" }, payout: null });

    const page = JSON.parse(text(await client.callTool({ name: "list_receipts", arguments: { fromSeq: 1, limit: 3 } })));
    expect(page.map((r: { seq: number }) => r.seq)).toEqual([1, 2, 3]);

    const verified = JSON.parse(text(await client.callTool({ name: "verify_chain", arguments: {} })));
    expect(verified).toMatchObject({ ok: true, firstBrokenSeq: null });
    expect(spans.some((s) => s.tool === "verify_chain" && s.ok)).toBe(true);
  });
});

describe("the door in front of it", () => {
  const req = (headers: Record<string, string>) => new Request("http://handoff.test/api/mcp", { method: "POST", headers });

  it("is closed when no token is configured", () => {
    const r = checkDoor(req({ authorization: `Bearer ${TOKEN}` }), {});
    expect(r.ok ? 0 : r.response.status).toBe(503);
  });

  it.each([
    ["no token", {}, 401],
    ["a wrong token", { authorization: "Bearer nope" }, 401],
    ["an unlisted browser origin", { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" }, 403],
  ])("refuses %s", (_label, headers, status) => {
    const r = checkDoor(req(headers as Record<string, string>), { token: TOKEN, allowedOrigins: ["https://inspector.example"] });
    expect(r.ok ? 200 : r.response.status).toBe(status);
  });

  it("admits the right token, and a listed origin", () => {
    expect(checkDoor(req({ authorization: `Bearer ${TOKEN}` }), { token: TOKEN }).ok).toBe(true);
    expect(checkDoor(req({ authorization: `Bearer ${TOKEN}`, origin: "https://inspector.example" }), { token: TOKEN, allowedOrigins: ["https://inspector.example"] }).ok).toBe(true);
  });

  it("refuses an MCP client without the token end to end", async () => {
    const err = await connect({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
  });
});
