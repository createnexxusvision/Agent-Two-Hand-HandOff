/**
 * The demo studio used by tests, scripts and the seeded app: Maya's week of Nov 2, 2026.
 * All people, addresses and amounts are fictional sandbox data.
 */
import { domainHash, type Sha256Ref } from "@handoff/trust";
import { MANDATE_PROFILE, MANDATE_VCT, type LaborMandate } from "./mandate.ts";

export const DEMO_PAYEE_SALT = "demo-salt-not-secret";

export function payeeRef(address: string, salt: string = DEMO_PAYEE_SALT): Sha256Ref {
  return domainHash("a2h-payee-ref-v1", { salt, address: address.trim().toLowerCase() });
}

export const DEMO_RECEIVERS = {
  theo: { email: "theo@example.com", wallet: "PAYPAL" },
  ana: { email: "ana@example.com", wallet: "PAYPAL" },
  sam: { email: "sam@example.com", wallet: "PAYPAL" },
} as const;

export const DEMO_TERMS =
  "Maya's studio, week of Nov 2, 2026. Payees: Theo R., Ana P., Sam K. Short video edit $40.00 per short; " +
  "thumbnail pack $150.00 per pack; captions $15.00 per video. At most $300.00 per week. " +
  "Anything over $100.00 needs my approval. Pay only for verified work.";

export type DemoMandateOptions = { mandateId?: string; validFrom?: string; validUntil?: string };

/** Maya's mandate. Defaults to the week of Nov 2, 2026; the live demo passes the current week. */
export function demoMandate(options: DemoMandateOptions = {}): LaborMandate {
  const validFrom = options.validFrom ?? "2026-11-02T00:00:00.000Z";
  const validUntil = options.validUntil ?? "2026-11-09T00:00:00.000Z";
  return {
    vct: MANDATE_VCT,
    profile: MANDATE_PROFILE,
    mandateId: options.mandateId ?? "m-maya-2026w45",
    principal: { id: "maya", displayName: "Maya L." },
    intentSummary: "Ship 3 shorts this week. Pay only for verified work.",
    payees: [
      { id: "theo", displayName: "Theo R.", payeeRef: payeeRef(DEMO_RECEIVERS.theo.email), kind: "individual", rail: "PAYPAL" },
      { id: "ana", displayName: "Ana P.", payeeRef: payeeRef(DEMO_RECEIVERS.ana.email), kind: "individual", rail: "PAYPAL" },
      { id: "sam", displayName: "Sam K.", payeeRef: payeeRef(DEMO_RECEIVERS.sam.email), kind: "individual", rail: "PAYPAL" },
    ],
    rateCard: [
      { id: "short-edit-v1", description: "Short video edit", unit: "short", amountMinor: 4000, currency: "USD", maxQuantity: 3 },
      { id: "thumb-pack-v1", description: "Thumbnail pack", unit: "pack", amountMinor: 15000, currency: "USD", maxQuantity: 1 },
      { id: "caption-v1", description: "Captions", unit: "video", amountMinor: 1500, currency: "USD", maxQuantity: 10 },
    ],
    limits: { currency: "USD", weeklyCapMinor: 30000, approvalOverMinor: 10000 },
    validFrom,
    validUntil,
    iat: Math.floor(Date.parse(validFrom) / 1000),
    exp: Math.floor(Date.parse(validUntil) / 1000),
    cnf: { kid: "policy-engine-2026-11" },
    presentedTermsHash: domainHash("a2h-presented-terms-v1", DEMO_TERMS),
    authMethod: "demo",
  };
}
