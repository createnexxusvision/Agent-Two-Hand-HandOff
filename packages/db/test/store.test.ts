import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ed25519Signer, mlDsa65Signer, verifyLedger } from "@handoff/trust";
import { migrate, openPglite, splitStatements, type Db } from "../src/db.ts";
import { Store } from "../src/store.ts";

const seed = (n: number) => new Uint8Array(32).fill(n);
const creator = ed25519Signer("creator-k", "creator", seed(1));
const policy = ed25519Signer("policy-k", "policy-engine", seed(2));
const cpEd = ed25519Signer("cp-ed", "system", seed(3));
const cpPq = mlDsa65Signer("cp-pq", "system", seed(4));

let db: Db;
let store: Store;
let schemaCount = 0;

// One embedded Postgres per file (it takes seconds to boot); each test gets a fresh schema.
beforeAll(async () => {
  db = await openPglite();
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  const schema = `t${++schemaCount}`;
  await db.exec(`create schema ${schema}; set search_path to ${schema}`);
  await migrate(db);
  store = new Store(db);
  await store.addKeys([creator.publicKey, policy.publicKey, cpEd.publicKey, cpPq.publicKey]);
});

async function fill(n: number) {
  await store.append("MANDATE", "creator", { mandateId: "m-1" }, [creator]);
  for (let i = 2; i <= n; i++) await store.append("DECISION", "policy-engine", { n: i, amountMinor: 4000 }, [policy]);
}

describe("migrations", () => {
  it("apply once and are idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
    const tables = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = current_schema() order by tablename");
    expect(tables.rows.map((r) => r.tablename)).toEqual(
      expect.arrayContaining(["receipts", "checkpoints", "keys", "payee_secrets", "webhook_events", "payout_jobs", "agents", "eval_runs"]),
    );
  });

  it("split statements without breaking $$ function bodies", () => {
    const parts = splitStatements(
      "-- a comment; with a semicolon\ncreate function f() returns int language sql as $$ select 1; $$;\nselect 'it''s; fine';\n-- trailing comment\n",
    );
    expect(parts).toEqual(["create function f() returns int language sql as $$ select 1; $$", "select 'it''s; fine'"]);
  });
});

describe("receipts table", () => {
  it("stores a chain that verifies offline after export", async () => {
    await fill(6);
    await store.checkpoint([cpEd, cpPq]);
    const report = verifyLedger(await store.exportLedger());
    expect(report.ok).toBe(true);
    expect(report.chain.checked).toBe(6);
  });

  it.each([
    ["UPDATE", "update receipts set actor = 'creator' where seq = 2"],
    ["DELETE", "delete from receipts where seq = 3"],
    ["TRUNCATE", "truncate receipts cascade"],
  ])("refuses %s", async (_label, sql) => {
    await fill(3);
    await expect(db.query(sql)).rejects.toThrow(/append-only/);
    expect((await store.receipts()).length).toBe(3);
  });

  it("refuses edits to stored checkpoints", async () => {
    await fill(3);
    await store.checkpoint([cpEd, cpPq]);
    await expect(db.query("update checkpoints set note = 'x'")).rejects.toThrow(/append-only/);
  });

  it("still catches an admin who disables the trigger and edits a payout", async () => {
    await fill(5);
    await store.checkpoint([cpEd, cpPq]);
    await db.exec("alter table receipts disable trigger receipts_append_only");
    await db.query("update receipts set receipt = jsonb_set(receipt, '{body,amountMinor}', '40000') where seq = 4");
    const report = verifyLedger(await store.exportLedger());
    expect(report.ok).toBe(false);
    expect(report.chain.firstBrokenSeq).toBe(4);
    expect(report.checkpoints[0]!.rootMatches).toBe(false);
  });

  it("keeps one unbroken chain under concurrent appends", async () => {
    await store.append("MANDATE", "creator", { mandateId: "m-1" }, [creator]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append("DECISION", "policy-engine", { n: i }, [policy])));
    const receipts = await store.receipts();
    expect(receipts.map((r) => r.seq)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(verifyLedger(await store.exportLedger()).ok).toBe(true);
  });

  it("refuses to rebind a key id to a different key", async () => {
    await expect(store.addKeys([ed25519Signer("creator-k", "creator", seed(9)).publicKey])).rejects.toThrow(/different key/);
  });
});

describe("payee addresses", () => {
  it("are stored encrypted and read back with the master key", async () => {
    const master = new Uint8Array(randomBytes(32));
    await store.putPayeeAddress("theo", "theo@example.com", master);
    const raw = await db.query<{ envelope: unknown }>("select envelope from payee_secrets");
    expect(JSON.stringify(raw.rows)).not.toContain("theo@example.com");
    expect(await store.getPayeeAddress("theo", master)).toBe("theo@example.com");
    await expect(store.getPayeeAddress("theo", new Uint8Array(randomBytes(32)))).rejects.toThrow();
  });
});

describe("webhooks and payout jobs", () => {
  it("processes each webhook event once", async () => {
    expect(await store.claimWebhookEvent("WH-1", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).toBe(true);
    expect(await store.claimWebhookEvent("WH-1", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).toBe(false);
  });

  it("hands each ready job to exactly one claimant", async () => {
    await fill(4);
    await store.upsertPayoutJob("dk-a", 2, "ready");
    await store.upsertPayoutJob("dk-b", 3, "ready");
    await store.upsertPayoutJob("dk-c", 4, "waiting_approval");
    const [first, second] = await Promise.all([store.claimReadyJobs(1), store.claimReadyJobs(5)]);
    const claimed = [...first, ...second].map((j) => j.decisionKey).sort();
    expect(claimed).toEqual(["dk-a", "dk-b"]);
    expect(await store.claimReadyJobs(5)).toEqual([]);
  });

  it("never moves a submitted job back to ready", async () => {
    await fill(2);
    await store.upsertPayoutJob("dk-a", 2, "ready");
    await store.claimReadyJobs(1);
    await store.upsertPayoutJob("dk-a", 2, "ready");
    expect((await store.jobs())[0]).toMatchObject({ decisionKey: "dk-a", state: "submitted", attempts: 1 });
    await store.finishJobs(["dk-a"], "done", { senderBatchId: "pr-1", payoutBatchId: "B-1" });
    expect((await store.jobs())[0]!.state).toBe("done");
  });
});
