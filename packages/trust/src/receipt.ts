import type { Json } from "./canonical.ts";
import { domainHash, isSha256Ref, utf8, ZERO_HASH, type Sha256Ref } from "./hash.ts";
import { signWith, type Actor, type SignatureValue, type Signer } from "./keys.ts";

export const RECEIPT_DOMAIN = "a2h-receipt-v1";

export const RECORD_TYPES = [
  "KEYS",
  "MANDATE",
  "REVOCATION",
  "PROPOSAL",
  "TASK",
  "DELIVERY",
  "VERDICT",
  "DECISION",
  "APPROVAL",
  "PAYOUT",
  "CONFIRMATION",
  "RETURN",
  "ANCHOR",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/** Which actor may sign each record type. Enforced when sealing and again when verifying. */
export const SIGNING_ACTORS: Record<RecordType, readonly Actor[]> = {
  KEYS: ["system"],
  MANDATE: ["creator"],
  REVOCATION: ["creator"],
  PROPOSAL: ["assistant", "ops-agent"],
  TASK: ["ops-agent"],
  DELIVERY: ["contractor"],
  VERDICT: ["verifier"],
  DECISION: ["policy-engine"],
  APPROVAL: ["creator"],
  PAYOUT: ["policy-engine"],
  CONFIRMATION: ["webhook-handler"],
  RETURN: ["webhook-handler"],
  ANCHOR: ["system"],
};

export interface ReceiptDraft {
  seq: number;
  type: RecordType;
  prev: Sha256Ref;
  /** ISO 8601 UTC timestamp. */
  ts: string;
  actor: Actor;
  body: { [key: string]: Json };
}

export interface Receipt extends ReceiptDraft {
  v: 1;
  hash: Sha256Ref;
  sigs: SignatureValue[];
}

export function receiptHash(draft: ReceiptDraft): Sha256Ref {
  const { seq, type, prev, ts, actor, body } = draft;
  return domainHash(RECEIPT_DOMAIN, { v: 1, seq, type, prev, ts, actor, body });
}

/** Signatures cover the UTF-8 bytes of the receipt hash string. */
export function receiptSigningMessage(hash: Sha256Ref): Uint8Array {
  return utf8(hash);
}

export function sealReceipt(draft: ReceiptDraft, signers: readonly Signer[]): Receipt {
  if (!Number.isSafeInteger(draft.seq) || draft.seq < 1) throw new RangeError("seq must be a positive integer");
  if (!isSha256Ref(draft.prev)) throw new TypeError("prev must be a sha256 reference");
  if (draft.seq === 1 && draft.prev !== ZERO_HASH) throw new Error("the first receipt must point to the zero hash");
  if (signers.length === 0) throw new Error("a receipt needs at least one signature");
  const allowed = SIGNING_ACTORS[draft.type];
  if (!allowed.includes(draft.actor)) throw new Error(`${draft.actor} may not sign ${draft.type}`);
  for (const s of signers) {
    if (s.actor !== draft.actor) throw new Error(`key ${s.kid} belongs to ${s.actor}, not ${draft.actor}`);
  }
  const hash = receiptHash(draft);
  const message = receiptSigningMessage(hash);
  return { v: 1, ...draft, hash, sigs: signers.map((s) => signWith(s, message)) };
}

/** Append-only in-memory chain. The database layer mirrors this API. */
export class ReceiptLog {
  private readonly items: Receipt[] = [];

  constructor(existing: readonly Receipt[] = []) {
    this.items.push(...existing);
  }

  get head(): Sha256Ref {
    return this.items.at(-1)?.hash ?? ZERO_HASH;
  }

  get length(): number {
    return this.items.length;
  }

  append(
    type: RecordType,
    actor: Actor,
    body: { [key: string]: Json },
    signers: readonly Signer[],
    ts: string = new Date().toISOString(),
  ): Receipt {
    const receipt = sealReceipt({ seq: this.items.length + 1, type, prev: this.head, ts, actor, body }, signers);
    this.items.push(receipt);
    return receipt;
  }

  all(): readonly Receipt[] {
    return this.items;
  }
}
