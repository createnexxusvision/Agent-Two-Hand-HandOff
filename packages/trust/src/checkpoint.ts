/**
 * Signed checkpoints in a C2SP tlog-checkpoint style note:
 *
 *   <origin>
 *   <tree size>
 *   <base64 root hash>
 *   issued <ISO timestamp>
 *
 * Each checkpoint is co-signed with Ed25519 and ML-DSA-65, the dual-signature pattern
 * NIST IR 8547 accepts during the post-quantum transition.
 */
import { toBase64, utf8, type Sha256Ref } from "./hash.ts";
import { signWith, verifySignature, type Alg, type Actor, type Keyring, type SignatureValue, type Signer } from "./keys.ts";
import { leafHash, rootFromLeafHashes } from "./merkle.ts";

export const DEFAULT_ORIGIN = "handoff.demo/receipts/v1";
export const CHECKPOINT_ACTORS: readonly Actor[] = ["system"];
export const REQUIRED_CHECKPOINT_ALGS: readonly Alg[] = ["Ed25519", "ML-DSA-65"];

export interface Checkpoint {
  origin: string;
  treeSize: number;
  /** base64 (standard alphabet, as in C2SP notes) */
  root: string;
  issuedAt: string;
  sigs: SignatureValue[];
}

export function receiptLeaves(hashes: readonly Sha256Ref[]): Uint8Array[] {
  return hashes.map((h) => leafHash(utf8(h)));
}

export function rootOfReceipts(hashes: readonly Sha256Ref[]): Uint8Array {
  return rootFromLeafHashes(receiptLeaves(hashes));
}

export function checkpointNote(cp: Pick<Checkpoint, "origin" | "treeSize" | "root" | "issuedAt">): string {
  return `${cp.origin}\n${cp.treeSize}\n${cp.root}\nissued ${cp.issuedAt}\n`;
}

export function createCheckpoint(
  hashes: readonly Sha256Ref[],
  signers: readonly Signer[],
  options: { origin?: string; issuedAt?: string } = {},
): Checkpoint {
  if (hashes.length === 0) throw new Error("cannot checkpoint an empty log");
  for (const s of signers) {
    if (!CHECKPOINT_ACTORS.includes(s.actor)) throw new Error(`${s.actor} may not sign checkpoints`);
  }
  const unsigned = {
    origin: options.origin ?? DEFAULT_ORIGIN,
    treeSize: hashes.length,
    root: toBase64(rootOfReceipts(hashes)),
    issuedAt: options.issuedAt ?? new Date().toISOString(),
  };
  const message = utf8(checkpointNote(unsigned));
  return { ...unsigned, sigs: signers.map((s) => signWith(s, message)) };
}

export interface CheckpointSignatureReport {
  ok: boolean;
  validAlgs: Alg[];
  problems: string[];
}

export function verifyCheckpointSignatures(
  cp: Checkpoint,
  keyring: Keyring,
  requiredAlgs: readonly Alg[] = REQUIRED_CHECKPOINT_ALGS,
): CheckpointSignatureReport {
  const message = utf8(checkpointNote(cp));
  const problems: string[] = [];
  const validAlgs: Alg[] = [];
  for (const sig of cp.sigs) {
    const key = keyring.get(sig.kid);
    if (!key) {
      problems.push(`unknown key ${sig.kid}`);
      continue;
    }
    if (!CHECKPOINT_ACTORS.includes(key.actor)) {
      problems.push(`key ${sig.kid} belongs to ${key.actor}, which may not sign checkpoints`);
      continue;
    }
    if (verifySignature(key, message, sig)) validAlgs.push(sig.alg);
    else problems.push(`${sig.alg} signature by ${sig.kid} does not verify`);
  }
  for (const alg of requiredAlgs) {
    if (!validAlgs.includes(alg)) problems.push(`missing a valid ${alg} signature`);
  }
  return { ok: problems.length === 0, validAlgs, problems };
}

/** Parses a note written by `checkpointNote`. Used to read anchored copies kept outside the database. */
export function parseCheckpointNote(note: string): Pick<Checkpoint, "origin" | "treeSize" | "root" | "issuedAt"> {
  const lines = note.split("\n");
  const [origin, size, root, issued] = lines;
  if (!origin || !size || !root || !issued?.startsWith("issued ")) throw new Error("malformed checkpoint note");
  const treeSize = Number(size);
  if (!Number.isSafeInteger(treeSize) || treeSize < 1) throw new Error("malformed tree size");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(root)) throw new Error("malformed root hash");
  return { origin, treeSize, root, issuedAt: issued.slice("issued ".length) };
}
