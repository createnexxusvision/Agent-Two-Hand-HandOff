/**
 * The money loop against storage. Every state change is a signed receipt; everything the
 * engine needs to know is rebuilt from receipts before it acts.
 */
import { randomBytes } from "node:crypto";
import { agentModel, measure, proposeTasks, verifyDelivery, type DeliveredFile } from "@handoff/agents";
import type { Store } from "@handoff/db";
import { verifyWebhookSignature, type HeaderLookup, type PayPalClient } from "@handoff/paypal";
import { approvalWindow, decide, decisionKey, factsFor, mandateHash, project, screenName, type LedgerView } from "@handoff/policy";
import { DEMO_RECEIVERS, demoMandate } from "@handoff/policy/demo";
import { assertPayable, executePayRun, readPayRun, type Payable } from "@handoff/policy/execute";
import {
  Keyring,
  sha256,
  sha256Ref,
  utf8,
  verifyChain,
  verifyLedger,
  type Actor,
  type Json,
  type LedgerReport,
  type Receipt,
  type RecordType,
  type Signer,
} from "@handoff/trust";
import type { ServerSigners } from "./keys.ts";
import { DEMO_GOAL, scriptedPlan, simulateDelivery, type PlannedTask } from "./simulate.ts";

export const DEMO_PAYEE_IDS = Object.keys(DEMO_RECEIVERS);

export type EngineConfig = {
  store: Store;
  signers: ServerSigners;
  masterKey: Uint8Array;
  /** Sandbox email per demo payee; Payouts to addresses without a sandbox account stay unclaimed. */
  payeeEmails: Record<string, string>;
  paypal?: PayPalClient;
  webhookId?: string;
  /** When true, the ops and verifier agents call the configured model; otherwise the demo is scripted. */
  useAi: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  log?: (line: string) => void;
  /** Minimum gap between demo runs, so a public button cannot drain the sandbox or the AI quota. */
  demoCooldownMs?: number;
};

export class EngineError extends Error {
  constructor(
    readonly code: "COOLDOWN" | "NOT_FOUND" | "INVALID" | "NOT_CONFIGURED" | "CHAIN_BROKEN",
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as { [key: string]: Json };

const ITEM_STATUS_EVENT: Record<string, string> = {
  SUCCESS: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  FAILED: "PAYMENT.PAYOUTS-ITEM.FAILED",
  UNCLAIMED: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  RETURNED: "PAYMENT.PAYOUTS-ITEM.RETURNED",
  BLOCKED: "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  REFUNDED: "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  ONHOLD: "PAYMENT.PAYOUTS-ITEM.HELD",
};
const EVENT_STATE: Record<string, string> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "CANCELED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.HELD": "HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
};
const RELEASED = new Set(["FAILED", "RETURNED", "CANCELED", "BLOCKED", "REFUNDED"]);

export class Engine {
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  constructor(readonly config: EngineConfig) {
    this.now = config.now ?? (() => new Date());
    this.log = config.log ?? ((line) => console.log(line));
  }

  private get store() {
    return this.config.store;
  }

  private append(type: RecordType, actor: Actor, body: { [key: string]: Json }, signer: Signer): Promise<Receipt> {
    return this.store.append(type, actor, body, [signer], this.now().toISOString());
  }

  /** Registers public keys and stores the demo payees' sandbox addresses, encrypted. */
  async bootstrap(): Promise<void> {
    await this.store.addKeys(this.config.signers.publicKeys(DEMO_PAYEE_IDS));
    for (const [payeeId, email] of Object.entries(this.config.payeeEmails)) {
      await this.store.putPayeeAddress(payeeId, email, this.config.masterKey);
    }
  }

  async view(): Promise<{ receipts: Receipt[]; view: LedgerView }> {
    const receipts = await this.store.receipts();
    return { receipts, view: project(receipts) };
  }

  /** Refuses to decide or pay on top of a chain that does not verify. */
  private async intactReceipts(): Promise<Receipt[]> {
    const receipts = await this.store.receipts();
    const report = verifyChain(receipts, new Keyring(await this.store.keys()));
    if (!report.ok) throw new EngineError("CHAIN_BROKEN", `receipt chain is broken at seq ${report.firstBrokenSeq}; refusing to continue`);
    return receipts;
  }

  /**
   * Step 1 of a demo week: a fresh mandate for the current week, signed by the creator.
   * Rate-limited so a public button cannot drain the sandbox or the AI quota.
   */
  async createDemoMandate(): Promise<{ mandateId: string }> {
    const now = this.now();
    const receipts = await this.intactReceipts();
    const lastMandate = [...receipts].reverse().find((r) => r.type === "MANDATE");
    const cooldown = this.config.demoCooldownMs ?? 60_000;
    if (lastMandate && now.getTime() - Date.parse(lastMandate.ts) < cooldown) {
      throw new EngineError("COOLDOWN", `a demo week started less than ${Math.round(cooldown / 1000)} s ago; try again shortly`);
    }
    const day = now.toISOString().slice(0, 10);
    const validFrom = `${day}T00:00:00.000Z`;
    const validUntil = new Date(Date.parse(validFrom) + 7 * 86_400_000).toISOString();
    const mandate = demoMandate({ mandateId: `m-maya-${day.replaceAll("-", "")}-${randomBytes(2).toString("hex")}`, validFrom, validUntil });
    const s = this.config.signers;
    await this.append("MANDATE", "creator", { mandate: json(mandate), mandateHash: mandateHash(mandate) }, s.creator);
    await this.append("PROPOSAL", "assistant", { tool: "propose_task", goal: DEMO_GOAL, via: "gateway.invoke", mandateId: mandate.mandateId }, s.assistant);
    return { mandateId: mandate.mandateId };
  }

  private mandateOf(view: LedgerView, mandateId: string) {
    const m = view.mandates.get(mandateId);
    if (!m) throw new EngineError("NOT_FOUND", `no mandate ${mandateId}`);
    return m.mandate;
  }

  /**
   * Step 2: tasks for the mandate, planned by the ops agent ("ai") or a script ("scripted").
   * Safe to rerun: if the mandate already has tasks, returns them. In "ai" mode an agent failure
   * throws, so the caller (a workflow retry, or the inline runner) decides whether to fall back.
   */
  async planTasks(mandateId: string, mode: "ai" | "scripted"): Promise<{ taskIds: string[]; planner: string }> {
    const view = project(await this.intactReceipts());
    const existing = [...view.tasks.entries()].filter(([, t]) => t.mandateId === mandateId).map(([id]) => id);
    if (existing.length) return { taskIds: existing, planner: "already planned" };
    const mandate = this.mandateOf(view, mandateId);
    const tag = mandateId.slice(-4);
    const day = this.now().toISOString().slice(0, 10);
    const due = new Date(Date.parse(mandate.validUntil) - 86_400_000).toISOString().slice(0, 10);

    let planned: PlannedTask[];
    let meta: { [key: string]: Json };
    const messages = new Map<string, string>();
    if (mode === "ai") {
      const { model, modelId } = agentModel("ops", this.config.env);
      const plan = await proposeTasks({ model, modelId, mandate, goal: DEMO_GOAL, today: day });
      planned = [];
      for (const t of plan.tasks) {
        for (let q = 0; q < t.quantity && planned.length < 6; q++) {
          planned.push({ taskId: `T-${tag}-${planned.length + 1}`, payeeId: t.payeeId, rateLineId: t.rateLineId, spec: t.spec, due: t.due });
        }
      }
      for (const m of plan.messages) messages.set(m.payeeId, m.text);
      meta = { planner: modelId, promptVersion: plan.promptVersion };
    } else {
      planned = scriptedPlan(due).map((t, i) => ({ ...t, taskId: `T-${tag}-${i + 1}` }));
      meta = { planner: "scripted" };
    }

    for (const t of planned) {
      await this.append(
        "TASK",
        "ops-agent",
        {
          taskId: t.taskId,
          mandateId,
          payeeId: t.payeeId,
          rateLineId: t.rateLineId,
          quantity: 1,
          due: t.due,
          spec: json(t.spec),
          aiDisclosure: true,
          ...(messages.has(t.payeeId) ? { message: messages.get(t.payeeId)! } : {}),
          ...meta,
        },
        this.config.signers.ops,
      );
    }
    return { taskIds: planned.map((t) => t.taskId), planner: String(meta.planner) };
  }

  /**
   * Step 3, one per task: a simulated contractor delivers, then the verifier ("ai") or the code
   * measurements alone ("measured") judge it. Safe to rerun: an existing delivery is reused and an
   * existing verdict is returned as is.
   */
  async deliverAndVerify(mandateId: string, taskId: string, mode: "ai" | "measured"): Promise<{ taskId: string; pass: boolean; verifier: string }> {
    const receipts = await this.intactReceipts();
    const view = project(receipts);
    const task = view.tasks.get(taskId);
    if (!task || task.mandateId !== mandateId) throw new EngineError("NOT_FOUND", `no task ${taskId} on ${mandateId}`);
    const done = [...view.verdicts.values()].find((v) => v.taskId === taskId);
    if (done) return { taskId, pass: done.pass, verifier: "already verified" };

    const taskReceipt = receipts.find((r) => r.type === "TASK" && r.body.taskId === taskId)!;
    const spec = taskReceipt.body.spec as unknown as PlannedTask["spec"];
    const planned: PlannedTask = { taskId, payeeId: task.payeeId, rateLineId: task.rateLineId, spec, due: String(taskReceipt.body.due ?? "") };
    const ordered = [...view.tasks.entries()].filter(([, t]) => t.mandateId === mandateId).map(([id, t]) => ({ id, rateLineId: t.rateLineId }));
    const index = ordered.findIndex((t) => t.id === taskId) + 1;
    const shortIndex = ordered.slice(0, index).filter((t) => t.rateLineId === "short-edit-v1").length;
    const sim = simulateDelivery(planned, index, shortIndex);

    let deliverySeq = [...view.deliveries.values()].find((d) => d.taskId === taskId)?.seq;
    if (deliverySeq === undefined) {
      const files = sim.files.map((f) => ({ ...f, sha256: sha256Ref(sha256(utf8(`demo file bytes: ${mandateId}/${taskId}/${f.name}`))) }));
      const delivery = await this.append(
        "DELIVERY",
        "contractor",
        { taskId, mandateId, files: files.map((f) => json(f)), ...(sim.note ? { note: { untrusted: true, text: sim.note } } : {}) },
        this.config.signers.contractor(task.payeeId),
      );
      deliverySeq = delivery.seq;
    }

    const verdict = mode === "ai" ? await this.judgeWithAgent(planned, sim.files, sim.note) : this.judgeByMeasurement(planned, sim.files);
    await this.append("VERDICT", "verifier", { taskId, deliverySeq, ...json(verdict) }, this.config.signers.verifier);
    return { taskId, pass: verdict.pass, verifier: verdict.modelId };
  }

  private async judgeWithAgent(task: PlannedTask, files: DeliveredFile[], note?: string) {
    const { model, modelId } = agentModel("verifier", this.config.env);
    const r = await verifyDelivery({ model, modelId, spec: task.spec, files, ...(note ? { note } : {}) });
    return { pass: r.pass, reasons: r.reasons, checks: r.checks, modelPass: r.modelPass, modelId: r.modelId, promptVersion: r.promptVersion };
  }

  private judgeByMeasurement(task: PlannedTask, files: DeliveredFile[]) {
    const checks = measure(task.spec, files);
    const failed = checks.filter((c) => !c.ok);
    return {
      pass: failed.length === 0,
      reasons: failed.length ? failed.map((c) => `${c.name}: ${c.detail}`) : ["All measured requirements met."],
      checks,
      modelId: "measured-only",
      promptVersion: "none",
    };
  }

  /**
   * Steps 2 to 4 in this process, for local runs and when Render Workflows is not configured.
   * An agent failure falls back to the script or to measurements, so the demo always completes.
   */
  async runDemoWeekInline(mandateId: string): Promise<{ mandateId: string; tasks: number; planner: string; verifier: string }> {
    let plan: { taskIds: string[]; planner: string };
    try {
      plan = await this.planTasks(mandateId, this.config.useAi ? "ai" : "scripted");
    } catch (e) {
      this.log(`ops agent failed, using the scripted plan: ${e instanceof Error ? e.message : String(e)}`);
      plan = await this.planTasks(mandateId, "scripted");
    }
    let verifier = "measured-only";
    for (const taskId of plan.taskIds) {
      try {
        verifier = (await this.deliverAndVerify(mandateId, taskId, this.config.useAi ? "ai" : "measured")).verifier;
      } catch (e) {
        this.log(`verifier agent failed, using measurements only: ${e instanceof Error ? e.message : String(e)}`);
        verifier = (await this.deliverAndVerify(mandateId, taskId, "measured")).verifier;
      }
    }
    await this.decidePending();
    return { mandateId, tasks: plan.taskIds.length, planner: plan.planner, verifier };
  }

  /** The whole demo week in this process. */
  async startDemoWeek(): Promise<{ mandateId: string; tasks: number; planner: string; verifier: string }> {
    const { mandateId } = await this.createDemoMandate();
    return this.runDemoWeekInline(mandateId);
  }

  /**
   * Pays ready work, then keeps reading PayPal until every submitted item settles or time runs
   * out, then seals a checkpoint. Safe to run concurrently: jobs are claimed with SKIP LOCKED and
   * each payout state is recorded once.
   */
  async settle(options: { maxMs?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
    const maxMs = options.maxMs ?? 10 * 60_000;
    const everyMs = options.everyMs ?? 10_000;
    const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const started = Date.now();
    let paid = 0;
    let recorded = 0;
    for (;;) {
      paid += (await this.payReady()).paid;
      recorded += await this.pollSubmitted();
      const pending = (await this.store.submittedJobs()).length;
      if (pending === 0 || Date.now() - started + everyMs > maxMs) {
        const checkpoint = (await this.checkpointIfDue()) ?? null;
        return { paid, recorded, pending, checkpoint };
      }
      await sleep(everyMs);
    }
  }

  /**
   * Demo weeks that started more than `olderThanMs` ago and are still missing tasks, verdicts or
   * decisions: the web service finishes them in-process if a workflow run failed outright.
   */
  async stalledMandates(olderThanMs: number): Promise<string[]> {
    const { receipts, view } = await this.view();
    const now = this.now().getTime();
    const stalled: string[] = [];
    for (const [mandateId, m] of view.mandates) {
      const signedAt = Date.parse(receipts.find((r) => r.seq === m.seq)!.ts);
      if (now - signedAt < olderThanMs) continue;
      const tasks = [...view.tasks.entries()].filter(([, t]) => t.mandateId === mandateId).map(([id]) => id);
      const verdicts = [...view.verdicts.values()].filter((v) => tasks.includes(v.taskId));
      const decisions = [...view.decisions.values()].filter((d) => d.decision.mandateId === mandateId);
      if (tasks.length === 0 || verdicts.length < tasks.length || decisions.length < verdicts.length) stalled.push(mandateId);
    }
    return stalled;
  }

  /** True while a demo week is still being planned, checked or paid; the page refreshes itself until then. */
  async busy(): Promise<boolean> {
    const { receipts, view } = await this.view();
    const lastMandate = [...view.mandates.values()].at(-1);
    if (lastMandate) {
      const id = lastMandate.mandate.mandateId;
      const tasks = [...view.tasks.values()].filter((t) => t.mandateId === id).length;
      const decided = [...view.decisions.values()].filter((d) => d.decision.mandateId === id).length;
      const age = this.now().getTime() - Date.parse(receipts.find((r) => r.seq === lastMandate.seq)!.ts);
      if ((tasks === 0 || decided < tasks) && age < 15 * 60_000) return true;
    }
    const jobs = await this.store.jobs();
    return jobs.some((j) => j.state === "ready" || j.state === "submitted");
  }

  /** Runs the policy engine on every verdict that has no decision yet. */
  async decidePending(): Promise<number> {
    let created = 0;
    for (;;) {
      const receipts = await this.intactReceipts();
      const view = project(receipts);
      const next = [...view.verdicts.values()].find((v) => {
        const task = view.tasks.get(v.taskId);
        return task?.mandateId && view.mandates.has(task.mandateId) && !view.decisions.has(decisionKey(task.mandateId, v.taskId, v.deliverySeq, v.seq));
      });
      if (!next) return created;
      const task = view.tasks.get(next.taskId)!;
      const m = view.mandates.get(task.mandateId!)!;
      const payee = m.mandate.payees.find((p) => p.id === task.payeeId);
      const screening = screenName(payee?.displayName ?? task.payeeId);
      const now = this.now();
      const decision = decide({
        mandate: m.mandate,
        mandateSignatureValid: true,
        mandateRevoked: m.revoked,
        task: { taskId: next.taskId, payeeId: task.payeeId, rateLineId: task.rateLineId, quantity: task.quantity },
        deliverySeq: next.deliverySeq,
        verdict: { seq: next.seq, pass: next.pass, reasons: next.reasons },
        payee: { screening: { result: screening.result, listSha256: screening.listSha256, ...(screening.matchedEntryId ? { matchedEntryId: screening.matchedEntryId } : {}) }, taxForm: "W-9" },
        facts: factsFor(view, m.mandate.mandateId, task.payeeId, now.getUTCFullYear()),
        now,
      });
      const receipt = await this.append("DECISION", "policy-engine", json(decision), this.config.signers.policy);
      if (decision.status === "APPROVED") await this.store.upsertPayoutJob(decision.decisionKey, receipt.seq, "ready");
      if (decision.status === "NEEDS_APPROVAL") await this.store.upsertPayoutJob(decision.decisionKey, receipt.seq, "waiting_approval");
      created++;
    }
  }

  /** The creator approves or declines one decision. The approval signs that decision's hash. */
  async approve(key: string, approved: boolean): Promise<Receipt> {
    const view = project(await this.intactReceipts());
    const entry = view.decisions.get(key);
    if (!entry) throw new EngineError("NOT_FOUND", `no decision ${key}`);
    if (entry.decision.status !== "NEEDS_APPROVAL") throw new EngineError("INVALID", "this decision does not need approval");
    if (view.approvals.has(key)) throw new EngineError("INVALID", "this decision was already answered");
    const receipt = await this.append(
      "APPROVAL",
      "creator",
      { decisionHash: entry.hash, decisionKey: key, approved, ...approvalWindow(this.now()) },
      this.config.signers.creator,
    );
    if (approved) await this.store.upsertPayoutJob(key, entry.seq, "ready");
    else await this.store.finishJobs([key], "failed", { error: "declined by the creator" });
    return receipt;
  }

  /** Claims ready jobs and pays them in one PayPal Payouts batch. */
  async payReady(): Promise<{ paid: number; failed: number; payoutBatchId?: string }> {
    const client = this.config.paypal;
    if (!client) return { paid: 0, failed: 0 };
    const jobs = await this.store.claimReadyJobs(50);
    if (!jobs.length) return { paid: 0, failed: 0 };
    const view = project(await this.intactReceipts());
    const now = this.now();
    const payables: Payable[] = [];
    let failed = 0;
    for (const job of jobs) {
      const entry = view.decisions.get(job.decisionKey);
      const payable: Payable | undefined = entry && {
        decision: entry.decision,
        decisionHash: entry.hash,
        ...(view.approvals.get(job.decisionKey) ? { approval: view.approvals.get(job.decisionKey)!.body } : {}),
      };
      try {
        if (!payable) throw new Error("decision not found");
        assertPayable(payable, now);
        payables.push(payable);
      } catch (e) {
        failed++;
        await this.store.finishJobs([job.decisionKey], "failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!payables.length) return { paid: 0, failed };

    const keys = payables.map((p) => p.decision.decisionKey);
    try {
      const run = await executePayRun({
        client,
        payables,
        resolveReceiver: async (payeeId) => ({ email: await this.store.getPayeeAddress(payeeId, this.config.masterKey), wallet: "PAYPAL" }),
        now,
        emailSubject: "Payment for verified work (HandOff sandbox demo)",
      });
      const payoutBatchId = run.batch.batch_header.payout_batch_id;
      const items = run.items.map((i) => {
        const entry = view.decisions.get(i.decisionKey)!;
        const mandate = view.mandates.get(entry.decision.mandateId)?.mandate;
        const payeeRef = mandate?.payees.find((p) => p.id === i.payeeId)?.payeeRef ?? null;
        return { senderItemId: i.senderItemId, decisionSeq: entry.seq, payeeId: i.payeeId, payeeRef, amountMinor: i.amountMinor, currency: "USD" };
      });
      await this.append(
        "PAYOUT",
        "policy-engine",
        {
          senderBatchId: run.senderBatchId,
          payoutBatchId,
          batchStatus: run.batch.batch_header.batch_status,
          mode: "sandbox",
          items,
          totalMinor: items.reduce((sum, i) => sum + i.amountMinor, 0),
        },
        this.config.signers.policy,
      );
      await this.store.finishJobs(keys, "submitted", { senderBatchId: run.senderBatchId, payoutBatchId });
      return { paid: payables.length, failed, payoutBatchId };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.log(`pay run failed: ${error}`);
      await this.store.finishJobs(keys, "failed", { error });
      return { paid: 0, failed: failed + keys.length };
    }
  }

  /** Records a payout item's new state as a signed receipt, once per state change. */
  async recordPayoutEvent(input: {
    eventId: string;
    eventType: string;
    senderItemId: string;
    payoutItemId?: string;
    transactionStatus?: string;
    source: "webhook" | "poll";
  }): Promise<Receipt | undefined> {
    const state = EVENT_STATE[input.eventType];
    if (!state) return undefined;
    const view = project(await this.intactReceipts());
    const payout = view.payouts.get(input.senderItemId);
    if (!payout || payout.state === state) return undefined;
    const type: RecordType = RELEASED.has(state) ? "RETURN" : "CONFIRMATION";
    const receipt = await this.append(
      type,
      "webhook-handler",
      {
        eventId: input.eventId,
        eventType: input.eventType,
        senderItemId: input.senderItemId,
        ...(input.payoutItemId ? { payoutItemId: input.payoutItemId } : {}),
        ...(input.transactionStatus ? { transactionStatus: input.transactionStatus } : {}),
        source: input.source,
        signatureCheck: input.source === "webhook" ? "verified by PayPal" : "status read from the PayPal API",
      },
      this.config.signers.webhook,
    );
    if (state === "SUCCEEDED") await this.store.finishJobs([input.senderItemId], "done");
    else if (RELEASED.has(state)) await this.store.finishJobs([input.senderItemId], "failed", { error: `PayPal reported ${state}` });
    return receipt;
  }

  /** Verifies a PayPal webhook with PayPal, records it once, and ignores everything else. */
  async handleWebhook(rawBody: string, header: HeaderLookup): Promise<"recorded" | "duplicate" | "ignored"> {
    const client = this.config.paypal;
    const webhookId = this.config.webhookId;
    if (!client || !webhookId) throw new EngineError("NOT_CONFIGURED", "PayPal webhooks are not configured");
    const event = await verifyWebhookSignature(client, { header, rawBody, webhookId });
    if (!(await this.store.claimWebhookEvent(event.id, event.event_type))) return "duplicate";
    if (!event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) return "ignored";
    const resource = event.resource as { payout_item_id?: string; transaction_status?: string; payout_item?: { sender_item_id?: string } };
    const senderItemId = resource.payout_item?.sender_item_id;
    if (!senderItemId) return "ignored";
    const receipt = await this.recordPayoutEvent({
      eventId: event.id,
      eventType: event.event_type,
      senderItemId,
      ...(resource.payout_item_id ? { payoutItemId: resource.payout_item_id } : {}),
      ...(resource.transaction_status ? { transactionStatus: resource.transaction_status } : {}),
      source: "webhook",
    });
    if (receipt) await this.store.linkWebhookReceipt(event.id, receipt.seq);
    return receipt ? "recorded" : "duplicate";
  }

  /** Fallback when webhooks are missing or late: read submitted batches from PayPal. */
  async pollSubmitted(): Promise<number> {
    const client = this.config.paypal;
    if (!client) return 0;
    const jobs = await this.store.submittedJobs();
    const batches = [...new Set(jobs.map((j) => j.payoutBatchId))];
    let recorded = 0;
    for (const batchId of batches) {
      const run = await readPayRun(client, batchId);
      for (const item of run.items) {
        const eventType = ITEM_STATUS_EVENT[item.transactionStatus];
        if (!eventType) continue;
        const r = await this.recordPayoutEvent({
          eventId: `poll:${item.payoutItemId}:${item.transactionStatus}`,
          eventType,
          senderItemId: item.senderItemId,
          payoutItemId: item.payoutItemId,
          transactionStatus: item.transactionStatus,
          source: "poll",
        });
        if (r) recorded++;
      }
    }
    return recorded;
  }

  async checkpointIfDue(): Promise<number | undefined> {
    const receipts = await this.store.receipts();
    const last = (await this.store.checkpoints()).at(-1);
    if (!receipts.length || (last && last.treeSize >= receipts.length)) return undefined;
    const cp = await this.store.checkpoint([this.config.signers.checkpointEd, this.config.signers.checkpointPq], this.now().toISOString());
    return cp.treeSize;
  }

  async report(): Promise<LedgerReport> {
    return verifyLedger(await this.store.exportLedger());
  }

  /** One pass of background work: pay, read statuses, checkpoint. */
  async tick(): Promise<void> {
    await this.payReady();
    await this.pollSubmitted();
    await this.checkpointIfDue();
  }
}
