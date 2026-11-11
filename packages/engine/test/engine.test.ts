import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate, openPglite, Store, type Db } from "@handoff/db";
import { PayPalClient, SANDBOX_API_BASE } from "@handoff/paypal";
import { project } from "@handoff/policy";
import { Engine, EngineError } from "../src/engine.ts";
import { LOCAL_DEMO_SEED, serverSigners } from "../src/keys.ts";

let db: Db;
let schemaCount = 0;
let clock = new Date("2026-10-15T16:00:00.000Z");

/** A fake PayPal that accepts batches and reports every item as SUCCESS when read. */
function fakePayPal() {
  const batches = new Map<string, { sender_item_id: string; amount: { value: string } }[]>();
  const invoices = new Map<string, { number: string; value: string; paid: boolean }>();
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (u.pathname === "/v1/oauth2/token") return reply(200, { access_token: "t", expires_in: 3600 });
    if (u.pathname === "/v1/payments/payouts" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { items: { sender_item_id: string; amount: { value: string } }[] };
      const id = `B-${batches.size + 1}`;
      batches.set(id, body.items);
      return reply(201, { batch_header: { payout_batch_id: id, batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });
    }
    if (u.pathname === "/v2/invoicing/invoices" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { detail: { invoice_number: string }; items: { unit_amount: { value: string } }[] };
      const id = `INV2-FAKE-${invoices.size + 1}`;
      invoices.set(id, { number: body.detail.invoice_number, value: body.items[0]!.unit_amount.value, paid: false });
      return reply(201, { rel: "self", href: `https://api.sandbox.paypal.com/v2/invoicing/invoices/${id}`, method: "GET" });
    }
    const inv = /^\/v2\/invoicing\/invoices\/(INV2-[A-Z0-9-]+)(\/send|\/payments)?$/.exec(u.pathname);
    if (inv && invoices.has(inv[1]!)) {
      const i = invoices.get(inv[1]!)!;
      if (inv[2] === "/send") return reply(202, {});
      if (inv[2] === "/payments") {
        i.paid = true;
        return reply(200, { payment_id: "PAY-1" });
      }
      return reply(200, {
        id: inv[1],
        status: i.paid ? "MARKED_AS_PAID" : "SENT",
        detail: { invoice_number: i.number, metadata: { recipient_view_url: "https://example.test/pay" } },
        amount: { currency_code: "USD", value: i.value },
        payments: i.paid ? { paid_amount: { currency_code: "USD", value: i.value } } : {},
      });
    }
    const m = /^\/v1\/payments\/payouts\/(.+)$/.exec(u.pathname);
    if (m && batches.has(m[1]!)) {
      const items = batches.get(m[1]!)!;
      return reply(200, {
        batch_header: { payout_batch_id: m[1], batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: "x" } },
        items: items.map((it, i) => ({ payout_item_id: `I-${m[1]}-${i}`, transaction_status: "SUCCESS", payout_batch_id: m[1], payout_item: { receiver: "r", sender_item_id: it.sender_item_id, amount: { currency: "USD", value: it.amount.value } } })),
      });
    }
    return reply(404, { name: "RESOURCE_NOT_FOUND" });
  }) as typeof fetch;
  return { client: new PayPalClient({ apiBase: SANDBOX_API_BASE, clientId: "id", clientSecret: "s" }, { fetch: fetchImpl, log: () => {} }), batches };
}

async function newEngine() {
  const store = new Store(db);
  const paypal = fakePayPal();
  const engine = new Engine({
    store,
    signers: serverSigners(LOCAL_DEMO_SEED),
    masterKey: new Uint8Array(32).fill(7),
    payeeEmails: { theo: "theo-sandbox@example.com", ana: "ana-sandbox@example.com", sam: "theo-sandbox@example.com" },
    paypal: paypal.client,
    useAi: false,
    now: () => clock,
    log: () => {},
  });
  await engine.bootstrap();
  return { engine, store, paypal };
}

beforeAll(async () => {
  db = await openPglite();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  clock = new Date("2026-10-15T16:00:00.000Z");
  await db.exec(`create schema e${++schemaCount}; set search_path to e${schemaCount}`);
  await migrate(db);
});

describe("engine: one demo week end to end", () => {
  it("decides, waits for approval, pays once, confirms and verifies", async () => {
    const { engine, store, paypal } = await newEngine();
    const started = await engine.startDemoWeek();
    expect(started).toMatchObject({ tasks: 4, planner: "scripted", verifier: "measured-only" });

    let { view } = await engine.view();
    const statuses = [...view.decisions.values()].map((d) => `${d.decision.taskId.replace(/^T-[0-9a-f]{4}-/, "T-")}:${d.decision.status}:${d.decision.amountMinor ?? "-"}`);
    expect(statuses).toEqual(["T-1:APPROVED:4000", "T-2:APPROVED:4000", "T-3:BLOCKED:-", "T-4:NEEDS_APPROVAL:15000"]);

    const thumbs = [...view.decisions.values()].find((d) => d.decision.status === "NEEDS_APPROVAL")!;
    await engine.approve(thumbs.decision.decisionKey, true);
    await expect(engine.approve(thumbs.decision.decisionKey, true)).rejects.toThrow(/already answered/);

    const run = await engine.payReady();
    expect(run).toMatchObject({ paid: 3, failed: 0, payoutBatchId: "B-1" });
    expect(paypal.batches.get("B-1")!.map((i) => i.amount.value)).toEqual(["40.00", "40.00", "150.00"]);
    expect(await engine.payReady()).toEqual({ paid: 0, failed: 0 });

    expect(await engine.pollSubmitted()).toBe(3);
    expect(await engine.pollSubmitted()).toBe(0);
    ({ view } = await engine.view());
    expect([...view.payouts.values()].map((p) => p.state)).toEqual(["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]);
    expect((await store.jobs()).map((j) => j.state)).toEqual(["done", "done", "done"]);

    expect(await engine.checkpointIfDue()).toBeGreaterThan(20);
    expect(await engine.checkpointIfDue()).toBeUndefined();
    const report = await engine.report();
    expect(report.ok).toBe(true);
  });

  it("keeps payee addresses out of every receipt", async () => {
    const { engine, store } = await newEngine();
    await engine.startDemoWeek();
    const thumbs = [...(await engine.view()).view.decisions.values()].find((d) => d.decision.status === "NEEDS_APPROVAL")!;
    await engine.approve(thumbs.decision.decisionKey, true);
    await engine.payReady();
    expect(JSON.stringify(await store.receipts())).not.toMatch(/sandbox@example\.com/);
  });

  it("stores the injected note as data and still pays only the rate card", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    const { receipts, view } = await engine.view();
    const noted = receipts.find((r) => r.type === "DELIVERY" && r.body.note);
    expect((noted!.body.note as { untrusted: boolean }).untrusted).toBe(true);
    const t2 = [...view.decisions.values()].find((d) => d.decision.taskId.endsWith("-2"))!;
    expect(t2.decision.amountMinor).toBe(4000);
  });

  it("runs two weeks back to back without re-deciding the first week", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    clock = new Date(clock.getTime() + 61_000);
    await engine.startDemoWeek();
    const { view } = await engine.view();
    expect(view.mandates.size).toBe(2);
    expect(view.decisions.size).toBe(8);
    const perMandate = new Map<string, number>();
    for (const { decision } of view.decisions.values()) perMandate.set(decision.mandateId, (perMandate.get(decision.mandateId) ?? 0) + 1);
    expect([...perMandate.values()]).toEqual([4, 4]);
  });

  it("can rerun every step without duplicating anything", async () => {
    const { engine, store } = await newEngine();
    const { mandateId } = await engine.createDemoMandate();
    const plan = await engine.planTasks(mandateId, "scripted");
    expect(await engine.planTasks(mandateId, "scripted")).toEqual({ taskIds: plan.taskIds, planner: "already planned" });
    for (const id of plan.taskIds) await engine.deliverAndVerify(mandateId, id, "measured");
    const again = await engine.deliverAndVerify(mandateId, plan.taskIds[0]!, "measured");
    expect(again.verifier).toBe("already verified");
    expect(await engine.decidePending()).toBe(4);
    expect(await engine.decidePending()).toBe(0);
    const types = (await store.receipts()).map((r) => r.type);
    expect(types.filter((t) => t === "DELIVERY")).toHaveLength(4);
    expect(types.filter((t) => t === "VERDICT")).toHaveLength(4);
    expect(types.filter((t) => t === "DECISION")).toHaveLength(4);
  });

  it("settles in one call: pays, reads PayPal until items settle, and seals a checkpoint", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    const result = await engine.settle({ everyMs: 1, sleep: async () => {} });
    expect(result).toMatchObject({ paid: 2, recorded: 2, pending: 0 });
    expect(result.checkpoint).toBeGreaterThan(15);
    expect((await engine.settle({ everyMs: 1, sleep: async () => {} })).paid).toBe(0);
  });

  it("rate-limits demo starts", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    await expect(engine.startDemoWeek()).rejects.toMatchObject({ code: "COOLDOWN" });
    clock = new Date(clock.getTime() + 61_000);
    await expect(engine.startDemoWeek()).resolves.toMatchObject({ tasks: 4 });
  });

  it("fails an approved payout whose approval expired before the pay run", async () => {
    const { engine, store } = await newEngine();
    await engine.startDemoWeek();
    const thumbs = [...(await engine.view()).view.decisions.values()].find((d) => d.decision.status === "NEEDS_APPROVAL")!;
    await engine.approve(thumbs.decision.decisionKey, true);
    clock = new Date(clock.getTime() + 16 * 60_000);
    const run = await engine.payReady();
    expect(run).toMatchObject({ paid: 2, failed: 1 });
    expect((await store.jobs()).find((j) => j.decisionKey === thumbs.decision.decisionKey)!.state).toBe("failed");
  });

  it("refuses to decide or pay on a tampered chain", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    await db.exec("alter table receipts disable trigger receipts_append_only");
    await db.query("update receipts set receipt = jsonb_set(receipt, '{body,taskId}', '\"T-9\"') where seq = 3");
    await db.exec("alter table receipts enable trigger receipts_append_only");
    clock = new Date(clock.getTime() + 61_000);
    const err = await engine.startDemoWeek().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).code).toBe("CHAIN_BROKEN");
    expect((await engine.report()).ok).toBe(false);
    expect(project((await engine.view()).receipts).decisions.size).toBe(4);
  });
});

describe("engine: stuck weeks and progress", () => {
  it("finds a week whose workflow never ran, and finishing it inline is safe", async () => {
    const { engine } = await newEngine();
    const { mandateId } = await engine.createDemoMandate();
    expect(await engine.busy()).toBe(true);
    expect(await engine.stalledMandates(5 * 60_000)).toEqual([]);
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect(await engine.stalledMandates(5 * 60_000)).toEqual([mandateId]);
    await engine.runDemoWeekInline(mandateId);
    await engine.runDemoWeekInline(mandateId);
    expect(await engine.stalledMandates(5 * 60_000)).toEqual([]);
    expect((await engine.view()).view.decisions.size).toBe(4);
  });

  it("is not busy once the week is decided and paid", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    expect(await engine.busy()).toBe(true);
    await engine.settle({ everyMs: 1, sleep: async () => {} });
    expect(await engine.busy()).toBe(false);
  });
});

describe("engine: webhooks get the first chance", () => {
  it("waits for the grace period before polling when webhooks are configured", async () => {
    const { engine, store } = await newEngine();
    const withHooks = new Engine({ ...engine.config, webhookId: "WH-1", webhookGraceMs: 120_000 });
    await withHooks.startDemoWeek();
    await withHooks.payReady();
    expect(await withHooks.pollSubmitted()).toBe(0);
    clock = new Date(clock.getTime() + 121_000);
    expect(await withHooks.pollSubmitted()).toBe(2);
    expect((await store.webhookStats()).verified).toBe(0);
  });
});

describe("engine: dashboard data", () => {
  it("reports budget, tax totals and flags from receipts", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    let d = await engine.dashboard();
    expect(d.chain.ok).toBe(true);
    expect(d.receipts.every((r) => r.status === "Verified")).toBe(true);
    expect(d.receipts[0]!.seq).toBe(d.receipts.length);
    expect(d.budget[0]).toMatchObject({ weeklyCapMinor: 30000, committedMinor: 8000, pendingApprovalMinor: 15000, paidMinor: 0, remainingMinor: 7000, blocked: 1 });
    expect(d.flags.map((f) => f.kind).sort()).toEqual(["payment_instruction_in_text", "policy_block"]);

    await engine.settle({ everyMs: 1, sleep: async () => {} });
    d = await engine.dashboard();
    expect(d.budget[0]).toMatchObject({ paidMinor: 8000 });
    const theo = d.tax.find((t) => t.payeeId === "theo")!;
    expect(theo).toMatchObject({ paidMinor: 8000, payments: 2, nec: { thresholdMinor: 200000, percent: 4, reached: false } });
    expect(d.tax.find((t) => t.payeeId === "sam")).toMatchObject({ paidMinor: 0, payments: 0 });
    expect(d.taxNote).toMatch(/not a filing decision/);
  });

  it("frees a declined payout from the budget and flags it", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    const held = [...(await engine.view()).view.decisions.values()].find((x) => x.decision.status === "NEEDS_APPROVAL")!;
    await engine.approve(held.decision.decisionKey, false);
    const d = await engine.dashboard();
    expect(d.budget[0]).toMatchObject({ committedMinor: 8000, pendingApprovalMinor: 0, remainingMinor: 22000 });
    expect(d.flags.some((f) => f.kind === "declined")).toBe(true);
  });

  it("marks tampered receipts Broken", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    await db.exec("alter table receipts disable trigger receipts_append_only");
    await db.query("update receipts set receipt = jsonb_set(receipt, '{body,taskId}', '\"T-x\"') where seq = 4");
    await db.exec("alter table receipts enable trigger receipts_append_only");
    const d = await engine.dashboard();
    expect(d.chain).toMatchObject({ ok: false, firstBrokenSeq: 4 });
    expect(d.receipts.filter((r) => r.status === "Broken").map((r) => r.seq).sort((a, b) => a - b)).toEqual([4, 5]);
    expect(d.flags.some((f) => f.kind === "chain_broken" && f.receiptSeq === 4)).toBe(true);
  });
});

describe("engine: AG Studio tables", () => {
  it("derives related tables from the receipts, with every key resolving", async () => {
    const { engine } = await newEngine();
    await engine.startDemoWeek();
    const { view } = await engine.view();
    const thumbs = [...view.decisions.values()].find((d) => d.decision.status === "NEEDS_APPROVAL")!;
    await engine.settle({ everyMs: 1, sleep: async () => {} });

    let data = await engine.studioData();
    const { tasks, payouts, payees, mandates, receipts, flags } = data.tables;
    expect(data.chain).toEqual({ ok: true, checked: receipts.length, firstBrokenSeq: null });
    expect(tasks.map((t) => `${t.rateLine}:${t.stage}:${t.amount}`).sort()).toEqual([
      "Short video edit:Blocked:40",
      "Short video edit:Paid:40",
      "Short video edit:Paid:40",
      "Thumbnail pack:Waiting for approval:150",
    ]);
    expect(tasks.reduce((s, t) => s + t.paidAmount, 0)).toBe(80);
    expect(tasks.find((t) => t.stage === "Blocked")).toMatchObject({ blockedBy: "verdict_pass", isBlocked: 1, verdict: "Fail" });
    expect(payees.find((p) => p.id === "theo")).toMatchObject({ name: "Theo R.", paidYtd: 80, payments: 2, necThreshold: 2000, necProgress: 0.04 });
    expect(mandates).toEqual([expect.objectContaining({ cap: 300, paid: 80, pendingApproval: 150, used: 230, remaining: 70, blocked: 1, isActive: 1 })]);
    expect(flags.some((f) => f.kind === "policy block")).toBe(true);

    // Every foreign key points at a row that exists, so Studio's joins never drop data.
    const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    for (const t of tasks) {
      expect(ids(payees).has(t.payeeId)).toBe(true);
      expect(ids(mandates).has(t.mandateId!)).toBe(true);
    }
    for (const p of payouts) expect(ids(tasks).has(p.taskId!)).toBe(true);
    for (const r of receipts) if (r.taskId) expect(ids(tasks).has(r.taskId)).toBe(true);
    expect(new Set(receipts.map((r) => r.actorKind))).toEqual(new Set(["AI agent", "Plain code", "Person"]));
    expect(receipts.filter((r) => r.type === "PAYOUT").every((r) => r.actorKind === "Plain code")).toBe(true);

    await engine.approve(thumbs.decision.decisionKey, true);
    await engine.settle({ everyMs: 1, sleep: async () => {} });
    data = await engine.studioData();
    expect(data.tables.tasks.find((t) => t.rateLine === "Thumbnail pack")).toMatchObject({ stage: "Paid", paidAmount: 150 });
    expect(data.tables.payees.find((p) => p.id === "ana")).toMatchObject({ paidYtd: 150, payments: 1 });
  });
});

describe("engine: brand money in through PayPal Invoicing", () => {
  it("sends an invoice, records the payment once as income, and keeps the ledger valid", async () => {
    const { engine } = await newEngine();
    await engine.createDemoMandate();
    const sent = await engine.createBrandInvoice();
    expect(sent.invoiceNumber).toMatch(/^HO-20261015-[0-9A-F]{4}$/);

    await expect(engine.createBrandInvoice()).rejects.toMatchObject({ code: "COOLDOWN" });
    expect(await engine.syncInvoices()).toBe(0); // Still unpaid: nothing to record.

    let data = await engine.studioData();
    expect(data.tables.invoices).toEqual([expect.objectContaining({ brand: "Nova Audio", amount: 500, status: "Awaiting payment", outstandingAmount: 500, paidAmount: 0 })]);

    expect(await engine.simulateBrandPayment(sent.invoiceId)).toBe(1);
    expect(await engine.syncInvoices()).toBe(0); // Reading again never records a second receipt.
    await expect(engine.simulateBrandPayment(sent.invoiceId)).rejects.toMatchObject({ code: "INVALID" });
    await expect(engine.simulateBrandPayment("INV2-NOT-MINE")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { receipts, view } = await engine.view();
    expect(receipts.filter((r) => r.type === "INCOME")).toHaveLength(1);
    expect(receipts.find((r) => r.type === "INCOME")).toMatchObject({ actor: "webhook-handler", body: { paidMinor: 50000, signatureCheck: "status read from the PayPal API" } });
    expect(view.invoices.get(sent.invoiceId)).toMatchObject({ amountMinor: 50000, paidMinor: 50000 });
    data = await engine.studioData();
    expect(data.chain.ok).toBe(true);
    expect(data.tables.invoices[0]).toMatchObject({ status: "Paid", paidAmount: 500, outstandingAmount: 0 });
    expect(data.tables.receipts.filter((r) => r.type === "INVOICE" || r.type === "INCOME").map((r) => r.actorKind)).toEqual(["Person", "Plain code"]);
  });

  it("stops at the daily limit and needs a configured brand email", async () => {
    const { engine } = await newEngine();
    const limited = new Engine({ ...engine.config, invoicesPerDay: 2, invoiceCooldownMs: 0 });
    await limited.createBrandInvoice();
    await limited.createBrandInvoice();
    await expect(limited.createBrandInvoice()).rejects.toThrow(/daily invoice limit/);
    const noEmail = new Engine({ ...engine.config, payeeEmails: {} });
    await expect(noEmail.createBrandInvoice()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("engine: explainer", () => {
  it("summarizes the current week, scoped to it, and caches until the ledger changes", async () => {
    const { engine } = await newEngine();
    const first = await engine.explain(); // No mandate yet.
    expect(first.summary).toContain("0 tasks were decided");
    await engine.startDemoWeek();
    const a = await engine.explain();
    expect(a).toMatchObject({ source: "plain code", cached: false });
    expect(a.summary).toMatch(/4 tasks were decided: 2 approved, 1 waiting for the creator, 1 blocked\./);
    expect(a.summary).toContain("Waiting for approval: $150.00 for ana");
    expect(a.flags.map((f) => f.kind)).toContain("payment_instruction_in_text");
    expect((await engine.explain()).cached).toBe(true);
    await engine.settle({ everyMs: 1, sleep: async () => {} });
    const b = await engine.explain();
    expect(b.cached).toBe(false);
    expect(b.summary).toContain("2 payouts went to PayPal, $80.00 in total.");
  });
});
