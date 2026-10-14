import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.ts";

export type Sha256Ref = `sha256:${string}`;

export const ZERO_HASH: Sha256Ref = `sha256:${"0".repeat(64)}`;

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return new Uint8Array(h.digest());
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) throw new TypeError("invalid hex");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64Url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function sha256Ref(bytes: Uint8Array): Sha256Ref {
  return `sha256:${toHex(bytes)}`;
}

export function isSha256Ref(value: unknown): value is Sha256Ref {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

/** SHA-256 over a domain-separation label, a newline, and the RFC 8785 form of `value`. */
export function domainHash(domain: string, value: unknown): Sha256Ref {
  return sha256Ref(sha256(utf8(`${domain}\n`), utf8(canonicalize(value))));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
