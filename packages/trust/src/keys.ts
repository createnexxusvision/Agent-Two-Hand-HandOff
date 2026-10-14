import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify, randomBytes } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { fromBase64Url, toBase64Url } from "./hash.ts";

export type Alg = "Ed25519" | "ML-DSA-65";

export const ACTORS = [
  "system",
  "creator",
  "assistant",
  "ops-agent",
  "contractor",
  "verifier",
  "explainer",
  "policy-engine",
  "webhook-handler",
] as const;
export type Actor = (typeof ACTORS)[number];

export interface PublicKeyRecord {
  kid: string;
  alg: Alg;
  actor: Actor;
  /** Raw public key, base64url. */
  publicKey: string;
  revokedAt?: string;
}

export interface Signer {
  readonly kid: string;
  readonly alg: Alg;
  readonly actor: Actor;
  readonly publicKey: PublicKeyRecord;
  sign(message: Uint8Array): Uint8Array;
}

export interface SignatureValue {
  alg: Alg;
  kid: string;
  /** base64url */
  value: string;
}

// PKCS#8 DER prefix for an Ed25519 private key wrapping a 32-byte seed (RFC 8410).
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function ed25519Signer(kid: string, actor: Actor, seed: Uint8Array = randomBytes(32)): Signer {
  if (seed.length !== 32) throw new RangeError("Ed25519 seed must be 32 bytes");
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  if (typeof jwk.x !== "string") throw new Error("could not export Ed25519 public key");
  const publicKey: PublicKeyRecord = { kid, alg: "Ed25519", actor, publicKey: jwk.x };
  return {
    kid,
    alg: "Ed25519",
    actor,
    publicKey,
    sign: (message) => new Uint8Array(nodeSign(null, message, privateKey)),
  };
}

/** ML-DSA-65 (FIPS 204) through @noble/post-quantum: self-audited, not constant-time. Demo keys only. */
export function mlDsa65Signer(kid: string, actor: Actor, seed: Uint8Array = randomBytes(32)): Signer {
  if (seed.length !== 32) throw new RangeError("ML-DSA seed must be 32 bytes");
  const keys = ml_dsa65.keygen(seed);
  const publicKey: PublicKeyRecord = { kid, alg: "ML-DSA-65", actor, publicKey: toBase64Url(keys.publicKey) };
  return {
    kid,
    alg: "ML-DSA-65",
    actor,
    publicKey,
    sign: (message) => ml_dsa65.sign(message, keys.secretKey),
  };
}

export function signWith(signer: Signer, message: Uint8Array): SignatureValue {
  return { alg: signer.alg, kid: signer.kid, value: toBase64Url(signer.sign(message)) };
}

export function verifySignature(record: PublicKeyRecord, message: Uint8Array, signature: SignatureValue): boolean {
  if (record.alg !== signature.alg || record.kid !== signature.kid) return false;
  const sig = fromBase64Url(signature.value);
  try {
    if (record.alg === "Ed25519") {
      const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: record.publicKey }, format: "jwk" });
      return nodeVerify(null, message, key, sig);
    }
    return ml_dsa65.verify(sig, message, fromBase64Url(record.publicKey));
  } catch {
    return false;
  }
}

export class Keyring {
  private readonly records = new Map<string, PublicKeyRecord>();

  constructor(records: Iterable<PublicKeyRecord> = []) {
    for (const r of records) this.add(r);
  }

  add(record: PublicKeyRecord): void {
    const existing = this.records.get(record.kid);
    if (existing && existing.publicKey !== record.publicKey) {
      throw new Error(`key id ${record.kid} is already bound to a different key`);
    }
    this.records.set(record.kid, record);
  }

  get(kid: string): PublicKeyRecord | undefined {
    return this.records.get(kid);
  }

  list(): PublicKeyRecord[] {
    return [...this.records.values()];
  }
}
