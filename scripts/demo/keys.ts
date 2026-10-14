/**
 * Deterministic demo keys. Anyone can derive them from this file, which is the point:
 * the demo server holds every key, so receipts give tamper evidence and attribution,
 * not legal non-repudiation. Production keys belong in a KMS.
 */
import { ed25519Signer, mlDsa65Signer, sha256, utf8, type Actor, type Signer } from "@handoff/trust";

const seed = (kid: string) => sha256(utf8(`handoff demo key, not secret: ${kid}`));
const ed = (kid: string, actor: Actor) => ed25519Signer(kid, actor, seed(kid));

export const demoSigners = {
  creator: ed("creator-2026-11", "creator"),
  assistant: ed("assistant-2026-11", "assistant"),
  ops: ed("ops-agent-2026-11", "ops-agent"),
  theo: ed("contractor-theo-2026-11", "contractor"),
  ana: ed("contractor-ana-2026-11", "contractor"),
  verifier: ed("verifier-2026-11", "verifier"),
  policy: ed("policy-engine-2026-11", "policy-engine"),
  webhook: ed("webhook-handler-2026-11", "webhook-handler"),
  checkpointEd: ed("checkpoint-ed25519-2026-11", "system"),
  checkpointPq: mlDsa65Signer("checkpoint-mldsa65-2026-11", "system", seed("checkpoint-mldsa65-2026-11")),
} satisfies Record<string, Signer>;

export const demoPublicKeys = Object.values(demoSigners).map((s) => s.publicKey);
