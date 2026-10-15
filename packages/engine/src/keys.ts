/**
 * Server-held signing keys, derived from one secret seed with HKDF so a deployment needs a single
 * secret (TRUST_SIGNING_SEED). The demo server holds every actor's key: receipts give tamper
 * evidence and attribution, not legal non-repudiation.
 */
import { hkdfSync } from "node:crypto";
import { ed25519Signer, mlDsa65Signer, sha256, utf8, type PublicKeyRecord, type Signer } from "@handoff/trust";

export type ServerSigners = {
  creator: Signer;
  assistant: Signer;
  ops: Signer;
  verifier: Signer;
  policy: Signer;
  webhook: Signer;
  checkpointEd: Signer;
  checkpointPq: Signer;
  contractor: (payeeId: string) => Signer;
  publicKeys: (payeeIds: readonly string[]) => PublicKeyRecord[];
};

const VERSION = "v1";

export function serverSigners(seed: Uint8Array): ServerSigners {
  if (seed.length !== 32) throw new RangeError("signing seed must be 32 bytes");
  const derive = (kid: string) => new Uint8Array(hkdfSync("sha256", seed, utf8("a2h-keys-v1"), utf8(kid), 32));
  const ed = (kid: string, actor: Parameters<typeof ed25519Signer>[1]) => ed25519Signer(kid, actor, derive(kid));
  const contractors = new Map<string, Signer>();
  const contractor = (payeeId: string) => {
    let s = contractors.get(payeeId);
    if (!s) {
      s = ed(`contractor-${payeeId}-${VERSION}`, "contractor");
      contractors.set(payeeId, s);
    }
    return s;
  };
  const base = {
    creator: ed(`creator-${VERSION}`, "creator"),
    assistant: ed(`assistant-${VERSION}`, "assistant"),
    ops: ed(`ops-agent-${VERSION}`, "ops-agent"),
    verifier: ed(`verifier-${VERSION}`, "verifier"),
    policy: ed(`policy-engine-${VERSION}`, "policy-engine"),
    webhook: ed(`webhook-handler-${VERSION}`, "webhook-handler"),
    checkpointEd: ed(`checkpoint-ed25519-${VERSION}`, "system"),
    checkpointPq: mlDsa65Signer(`checkpoint-mldsa65-${VERSION}`, "system", derive(`checkpoint-mldsa65-${VERSION}`)),
  };
  return {
    ...base,
    contractor,
    publicKeys: (payeeIds) => [...Object.values(base), ...payeeIds.map(contractor)].map((s) => s.publicKey),
  };
}

/** A public, well-known seed for local runs. Never used on Render. */
export const LOCAL_DEMO_SEED = sha256(utf8("handoff local demo seed, not secret"));

export function signingSeedFromEnv(env: NodeJS.ProcessEnv = process.env): { seed: Uint8Array; demoKeys: boolean } {
  const raw = env.TRUST_SIGNING_SEED?.trim();
  if (raw) {
    const seed = Buffer.from(raw, "base64");
    if (seed.length !== 32) throw new Error("TRUST_SIGNING_SEED must decode to exactly 32 bytes");
    return { seed: new Uint8Array(seed), demoKeys: false };
  }
  if (env.RENDER) throw new Error("TRUST_SIGNING_SEED is required on Render");
  return { seed: LOCAL_DEMO_SEED, demoKeys: true };
}
