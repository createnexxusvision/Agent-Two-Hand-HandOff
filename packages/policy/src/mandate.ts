/**
 * The labor mandate: what a creator authorizes an agent team to pay for.
 *
 * Shaped after an AP2 open Payment Mandate (vct, validity, cnf key binding) with labor-specific
 * constraints AP2 does not define yet: a rate card, a weekly cap and an approval threshold.
 * Amounts are integer minor units (cents) and live only here, never in agent output.
 */
import { domainHash, type Sha256Ref } from "@handoff/trust";

export const MANDATE_PROFILE = "x-handoff.labor-mandate.v0";
export const MANDATE_VCT = "mandate.payment.open.1";

export type RateLine = {
  id: string;
  description: string;
  unit: string;
  amountMinor: number;
  currency: "USD";
  /** Largest quantity a single task may bill against this line. */
  maxQuantity: number;
};

export type MandatePayee = {
  id: string;
  displayName: string;
  /** Salted hash of the payout address. The address itself is stored encrypted, never in receipts. */
  payeeRef: Sha256Ref;
  kind: "individual" | "agent" | "device";
  rail: "PAYPAL" | "VENMO";
};

export type LaborMandate = {
  vct: typeof MANDATE_VCT;
  profile: typeof MANDATE_PROFILE;
  mandateId: string;
  principal: { id: string; displayName: string };
  intentSummary: string;
  payees: MandatePayee[];
  rateCard: RateLine[];
  limits: {
    currency: "USD";
    weeklyCapMinor: number;
    /** Payouts strictly above this amount wait for the creator's signed approval. */
    approvalOverMinor: number;
    lifetimeBudgetMinor?: number;
  };
  validFrom: string;
  validUntil: string;
  /** Epoch seconds, mirroring validFrom and validUntil for JWT-style consumers. */
  iat: number;
  exp: number;
  /** Key that may close this mandate into payment decisions: the policy engine's key. */
  cnf: { kid: string };
  /** Hash of the exact terms shown to the creator before signing. */
  presentedTermsHash: Sha256Ref;
  authMethod: "passkey" | "password" | "demo";
};

const isMinor = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Returns every structural problem. An empty list means the mandate is well formed. */
export function validateMandate(m: LaborMandate): string[] {
  const problems: string[] = [];
  if (m.vct !== MANDATE_VCT || m.profile !== MANDATE_PROFILE) problems.push("unsupported mandate profile");
  if (!m.mandateId) problems.push("missing mandateId");
  if (m.payees.length === 0) problems.push("no payees");
  if (m.rateCard.length === 0) problems.push("empty rate card");

  const payeeIds = new Set<string>();
  for (const p of m.payees) {
    if (payeeIds.has(p.id)) problems.push(`duplicate payee ${p.id}`);
    payeeIds.add(p.id);
  }
  const lineIds = new Set<string>();
  for (const line of m.rateCard) {
    if (lineIds.has(line.id)) problems.push(`duplicate rate line ${line.id}`);
    lineIds.add(line.id);
    if (!isMinor(line.amountMinor) || line.amountMinor === 0) problems.push(`rate line ${line.id} needs a positive amount in cents`);
    if (line.currency !== m.limits.currency) problems.push(`rate line ${line.id} uses a different currency`);
    if (!Number.isSafeInteger(line.maxQuantity) || line.maxQuantity < 1) problems.push(`rate line ${line.id} needs maxQuantity ≥ 1`);
  }

  if (!isMinor(m.limits.weeklyCapMinor)) problems.push("weekly cap must be cents");
  if (!isMinor(m.limits.approvalOverMinor)) problems.push("approval threshold must be cents");
  if (m.limits.lifetimeBudgetMinor !== undefined && !isMinor(m.limits.lifetimeBudgetMinor)) {
    problems.push("lifetime budget must be cents");
  }

  const from = Date.parse(m.validFrom);
  const until = Date.parse(m.validUntil);
  if (Number.isNaN(from) || Number.isNaN(until) || from >= until) problems.push("validity window is invalid");
  if (m.iat !== Math.floor(from / 1000) || m.exp !== Math.floor(until / 1000)) problems.push("iat/exp disagree with the validity window");
  return problems;
}

export function mandateHash(m: LaborMandate): Sha256Ref {
  return domainHash("a2h-mandate-v1", m);
}

export function findRateLine(m: LaborMandate, rateLineId: string): RateLine | undefined {
  return m.rateCard.find((l) => l.id === rateLineId);
}

export function findPayee(m: LaborMandate, payeeId: string): MandatePayee | undefined {
  return m.payees.find((p) => p.id === payeeId);
}
