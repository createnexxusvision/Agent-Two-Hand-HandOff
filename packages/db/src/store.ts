import {
  checkpointNote,
  createCheckpoint,
  LEDGER_FORMAT,
  openPrivate,
  sealPrivate,
  sealReceipt,
  ZERO_HASH,
  type Actor,
  type Checkpoint,
  type Json,
  type LedgerFile,
  type PublicKeyRecord,
  type Receipt,
  type RecordType,
  type SealedEnvelope,
  type Sha256Ref,
  type Signer,
} from "@handoff/trust";
import type { Db } from "./db.ts";

// Any constant works; it only has to be the same for every writer.
const RECEIPT_APPEND_LOCK = 0x48_4f_46_46;

export type PayoutJobState = "waiting_approval" | "ready" | "submitted" | "done" | "failed";

export class Store {
  constructor(readonly db: Db) {}

  async addKeys(records: readonly PublicKeyRecord[]): Promise<void> {
    for (const r of records) {
      await this.db.query(
        "insert into keys (kid, record) values ($1, $2) on conflict (kid) do nothing",
        [r.kid, JSON.stringify(r)],
      );
      const stored = await this.db.query<{ record: PublicKeyRecord }>("select record from keys where kid = $1", [r.kid]);
      if (stored.rows[0]!.record.publicKey !== r.publicKey) throw new Error(`key id ${r.kid} is already bound to a different key`);
    }
  }

  async keys(): Promise<PublicKeyRecord[]> {
    return (await this.db.query<{ record: PublicKeyRecord }>("select record from keys order by kid")).rows.map((r) => r.record);
  }

  /**
   * Appends one signed receipt. A transaction-scoped advisory lock serializes writers, so
   * two workers can never both read the same head and fork the chain.
   */
  async append(
    type: RecordType,
    actor: Actor,
    body: { [key: string]: Json },
    signers: readonly Signer[],
    ts: string = new Date().toISOString(),
  ): Promise<Receipt> {
    return this.db.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock($1)", [RECEIPT_APPEND_LOCK]);
      const head = await tx.query<{ seq: number; hash: Sha256Ref }>("select seq, hash from receipts order by seq desc limit 1");
      const last = head.rows[0];
      const receipt = sealReceipt({ seq: (last?.seq ?? 0) + 1, type, prev: last?.hash ?? ZERO_HASH, ts, actor, body }, signers);
      await tx.query(
        "insert into receipts (seq, type, actor, ts, prev, hash, receipt) values ($1, $2, $3, $4, $5, $6, $7)",
        [receipt.seq, receipt.type, receipt.actor, receipt.ts, receipt.prev, receipt.hash, JSON.stringify(receipt)],
      );
      return receipt;
    });
  }

  async receipts(): Promise<Receipt[]> {
    return (await this.db.query<{ receipt: Receipt }>("select receipt from receipts order by seq")).rows.map((r) => r.receipt);
  }

  async checkpoint(signers: readonly Signer[], issuedAt?: string): Promise<Checkpoint> {
    const hashes = (await this.db.query<{ hash: Sha256Ref }>("select hash from receipts order by seq")).rows.map((r) => r.hash);
    const cp = createCheckpoint(hashes, signers, issuedAt ? { issuedAt } : {});
    await this.db.query(
      "insert into checkpoints (tree_size, checkpoint, note) values ($1, $2, $3) on conflict (tree_size) do nothing",
      [cp.treeSize, JSON.stringify(cp), checkpointNote(cp)],
    );
    return cp;
  }

  async checkpoints(): Promise<Checkpoint[]> {
    return (await this.db.query<{ checkpoint: Checkpoint }>("select checkpoint from checkpoints order by tree_size")).rows.map((r) => r.checkpoint);
  }

  /** Everything a third party needs to run `pnpm verify` offline. */
  async exportLedger(): Promise<LedgerFile> {
    return { format: LEDGER_FORMAT, keys: await this.keys(), receipts: await this.receipts(), checkpoints: await this.checkpoints() };
  }

  async putPayeeAddress(payeeId: string, address: string, masterKey: Uint8Array): Promise<void> {
    const envelope = sealPrivate(address, masterKey, `payee:${payeeId}`);
    await this.db.query(
      `insert into payee_secrets (payee_id, envelope) values ($1, $2)
       on conflict (payee_id) do update set envelope = excluded.envelope, updated_at = now()`,
      [payeeId, JSON.stringify(envelope)],
    );
  }

  async getPayeeAddress(payeeId: string, masterKey: Uint8Array): Promise<string> {
    const row = (await this.db.query<{ envelope: SealedEnvelope }>("select envelope from payee_secrets where payee_id = $1", [payeeId])).rows[0];
    if (!row) throw new Error(`no payout address on file for ${payeeId}`);
    return openPrivate(row.envelope, masterKey, `payee:${payeeId}`);
  }

  /** Returns false when this webhook event was already processed. */
  async claimWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
    const res = await this.db.query<{ event_id: string }>(
      "insert into webhook_events (event_id, event_type) values ($1, $2) on conflict (event_id) do nothing returning event_id",
      [eventId, eventType],
    );
    return res.rows.length === 1;
  }

  async linkWebhookReceipt(eventId: string, seq: number): Promise<void> {
    await this.db.query("update webhook_events set receipt_seq = $2 where event_id = $1", [eventId, seq]);
  }

  async upsertPayoutJob(decisionKey: string, decisionSeq: number, state: PayoutJobState): Promise<void> {
    await this.db.query(
      `insert into payout_jobs (decision_key, decision_seq, state) values ($1, $2, $3)
       on conflict (decision_key) do update set state = excluded.state, updated_at = now()
       where payout_jobs.state in ('waiting_approval', 'ready')`,
      [decisionKey, decisionSeq, state],
    );
  }

  /**
   * Moves up to `limit` ready jobs to "submitted" and returns them. FOR UPDATE SKIP LOCKED
   * lets several workers run without ever picking the same decision.
   */
  async claimReadyJobs(limit: number): Promise<{ decisionKey: string; decisionSeq: number }[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<{ decision_key: string; decision_seq: number }>(
        `select decision_key, decision_seq from payout_jobs where state = 'ready'
         order by decision_seq limit $1 for update skip locked`,
        [limit],
      );
      for (const r of rows.rows) {
        await tx.query("update payout_jobs set state = 'submitted', attempts = attempts + 1, updated_at = now() where decision_key = $1", [r.decision_key]);
      }
      return rows.rows.map((r) => ({ decisionKey: r.decision_key, decisionSeq: r.decision_seq }));
    });
  }

  async finishJobs(decisionKeys: readonly string[], state: "done" | "failed" | "ready", detail: { senderBatchId?: string; payoutBatchId?: string; error?: string } = {}): Promise<void> {
    for (const key of decisionKeys) {
      await this.db.query(
        `update payout_jobs set state = $2, sender_batch_id = coalesce($3, sender_batch_id),
         payout_batch_id = coalesce($4, payout_batch_id), last_error = $5, updated_at = now() where decision_key = $1`,
        [key, state, detail.senderBatchId ?? null, detail.payoutBatchId ?? null, detail.error ?? null],
      );
    }
  }

  async jobs(): Promise<{ decisionKey: string; state: PayoutJobState; attempts: number }[]> {
    const rows = await this.db.query<{ decision_key: string; state: PayoutJobState; attempts: number }>(
      "select decision_key, state, attempts from payout_jobs order by decision_seq",
    );
    return rows.rows.map((r) => ({ decisionKey: r.decision_key, state: r.state, attempts: r.attempts }));
  }
}
