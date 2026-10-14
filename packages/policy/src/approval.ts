import type { Sha256Ref } from "@handoff/trust";

/** An approval is good for 15 minutes and for exactly one decision. */
export const APPROVAL_TTL_MS = 15 * 60 * 1000;

/** Body of an APPROVAL receipt. The receipt itself is signed by the creator's key. */
export type ApprovalBody = {
  decisionHash: Sha256Ref;
  decisionKey: string;
  approved: boolean;
  requestedAt: string;
  expiresAt: string;
};

export function approvalWindow(requestedAt: Date): { requestedAt: string; expiresAt: string } {
  return {
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + APPROVAL_TTL_MS).toISOString(),
  };
}

export function checkApproval(
  decision: { decisionHash: Sha256Ref; decisionKey: string },
  approval: ApprovalBody | undefined,
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (!approval) return { ok: false, reason: "waiting for the creator's approval" };
  if (!approval.approved) return { ok: false, reason: "the creator declined this payout" };
  if (approval.decisionHash !== decision.decisionHash || approval.decisionKey !== decision.decisionKey) {
    return { ok: false, reason: "the approval was signed for a different decision" };
  }
  const expires = Date.parse(approval.expiresAt);
  const requested = Date.parse(approval.requestedAt);
  if (Number.isNaN(expires) || Number.isNaN(requested) || expires - requested > APPROVAL_TTL_MS) {
    return { ok: false, reason: "the approval window is invalid" };
  }
  if (now.getTime() >= expires) return { ok: false, reason: "the approval expired" };
  return { ok: true };
}
