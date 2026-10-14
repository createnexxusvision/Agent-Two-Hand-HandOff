import { ZERO_HASH, type Sha256Ref } from "./hash.ts";
import { verifySignature, type Keyring } from "./keys.ts";
import { receiptHash, receiptSigningMessage, SIGNING_ACTORS, type Receipt } from "./receipt.ts";

export type ChainFailureCode =
  | "SEQ_GAP"
  | "PREV_MISMATCH"
  | "HASH_MISMATCH"
  | "NO_SIGNATURE"
  | "UNKNOWN_KEY"
  | "KEY_REVOKED"
  | "KEY_ACTOR_MISMATCH"
  | "ACTOR_NOT_ALLOWED"
  | "BAD_SIGNATURE";

export interface ChainFailure {
  seq: number;
  code: ChainFailureCode;
  message: string;
}

export interface ChainReport {
  ok: boolean;
  checked: number;
  /** Recomputed hashes, in order. A tampered receipt gets the hash of what is stored now. */
  hashes: Sha256Ref[];
  failures: ChainFailure[];
  firstBrokenSeq?: number;
}

/**
 * Walks the chain from seq 1. Links are checked against the recomputed hash of the previous
 * receipt, so editing one receipt's body also breaks the link of the receipt after it.
 */
export function verifyChain(receipts: readonly Receipt[], keyring: Keyring): ChainReport {
  const failures: ChainFailure[] = [];
  const hashes: Sha256Ref[] = [];
  let expectedPrev: Sha256Ref = ZERO_HASH;

  receipts.forEach((r, index) => {
    const seq = index + 1;
    const fail = (code: ChainFailureCode, message: string) => failures.push({ seq, code, message });

    if (r.seq !== seq) fail("SEQ_GAP", `expected seq ${seq}, found ${r.seq}`);
    if (r.prev !== expectedPrev) fail("PREV_MISMATCH", `prev does not match the hash of seq ${seq - 1}`);

    const recomputed = receiptHash(r);
    hashes.push(recomputed);
    if (recomputed !== r.hash) fail("HASH_MISMATCH", "stored content does not match its hash");

    const allowedActors = SIGNING_ACTORS[r.type];
    if (!allowedActors || !allowedActors.includes(r.actor)) {
      fail("ACTOR_NOT_ALLOWED", `${r.actor} may not sign ${r.type}`);
    }

    if (r.sigs.length === 0) fail("NO_SIGNATURE", "receipt has no signatures");
    const message = receiptSigningMessage(r.hash);
    for (const sig of r.sigs) {
      const key = keyring.get(sig.kid);
      if (!key) {
        fail("UNKNOWN_KEY", `unknown key ${sig.kid}`);
        continue;
      }
      if (key.revokedAt && key.revokedAt <= r.ts) fail("KEY_REVOKED", `key ${sig.kid} was revoked at ${key.revokedAt}`);
      if (key.actor !== r.actor) fail("KEY_ACTOR_MISMATCH", `key ${sig.kid} belongs to ${key.actor}, not ${r.actor}`);
      if (!verifySignature(key, message, sig)) fail("BAD_SIGNATURE", `signature by ${sig.kid} does not verify`);
    }

    expectedPrev = recomputed;
  });

  const firstBrokenSeq = failures.length ? Math.min(...failures.map((f) => f.seq)) : undefined;
  return { ok: failures.length === 0, checked: receipts.length, hashes, failures, firstBrokenSeq };
}
