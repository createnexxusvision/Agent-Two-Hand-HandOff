/**
 * Envelope encryption for personal data (payout addresses, names).
 *
 * Each record gets a fresh 256-bit data key. The record is encrypted with AES-256-GCM under
 * that key, and the data key is itself encrypted under the master key. Both layers bind the
 * caller's `aad` (for example "payee:theo"), so a ciphertext copied onto another record fails.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SealedEnvelope = {
  v: 1;
  alg: "A256GCM";
  /** Which master key wrapped the data key, for rotation. */
  kid: string;
  wrapped: { iv: string; ct: string; tag: string };
  data: { iv: string; ct: string; tag: string };
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url");

function encrypt(key: Uint8Array, plaintext: Uint8Array, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: b64(iv), ct: b64(ct), tag: b64(cipher.getAuthTag()) };
}

function decrypt(key: Uint8Array, part: { iv: string; ct: string; tag: string }, aad: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, unb64(part.iv));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(unb64(part.tag));
  return Buffer.concat([decipher.update(unb64(part.ct)), decipher.final()]);
}

export function parseMasterKey(base64: string | undefined): Uint8Array {
  if (!base64) throw new Error("TRUST_MASTER_KEY is not set (32 random bytes, base64)");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("TRUST_MASTER_KEY must decode to exactly 32 bytes");
  return new Uint8Array(key);
}

export function sealPrivate(plaintext: string, masterKey: Uint8Array, aad: string, kid = "master-v1"): SealedEnvelope {
  if (masterKey.length !== 32) throw new RangeError("master key must be 32 bytes");
  const dataKey = randomBytes(32);
  try {
    return {
      v: 1,
      alg: "A256GCM",
      kid,
      wrapped: encrypt(masterKey, dataKey, `wrap:${aad}`),
      data: encrypt(dataKey, Buffer.from(plaintext, "utf8"), `data:${aad}`),
    };
  } finally {
    dataKey.fill(0);
  }
}

/** Throws if the envelope, the master key or the aad do not match. */
export function openPrivate(envelope: SealedEnvelope, masterKey: Uint8Array, aad: string): string {
  if (envelope.v !== 1 || envelope.alg !== "A256GCM") throw new Error("unsupported envelope");
  const dataKey = decrypt(masterKey, envelope.wrapped, `wrap:${aad}`);
  try {
    return decrypt(dataKey, envelope.data, `data:${aad}`).toString("utf8");
  } finally {
    dataKey.fill(0);
  }
}
