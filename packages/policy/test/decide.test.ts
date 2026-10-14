import { describe, expect, it } from "vitest";
import { ZERO_HASH } from "@handoff/trust";
import { CHECK_ORDER, decide, decisionKey, type DecideInput } from "../src/decide.ts";
import { demoMandate } from "../src/demo-studio.ts";
import { validateMandate } from "../src/mandate.ts";

const clearPayee = { screening: { result: "clear" as const, listSha256: ZERO_HASH }, taxForm: "W-9" as const };

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    mandate: demoMandate(),
    mandateSignatureValid: true,
    mandateRevoked: false,
    task: { taskId: "T-102", payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1 },
    deliverySeq: 8,
    verdict: { seq: 12, pass: true, reasons: [] },
    payee: clearPayee,
    facts: { weekToDateMinor: 4000, payeeYearToDateMinor: 4000, payeeYearToDatePayments: 1, paidDecisionKeys: new Set() },
    now: new Date("2026-11-06T15:00:00.000Z"),
    ...overrides,
  };
}

describe("demo mandate", () => {
  it("is well formed", () => {
    expect(validateMandate(demoMandate())).toEqual([]);
  });
});

describe("decide", () => {
  it("approves short-02 at $40.00 with every check passing in order", () => {
    const d = decide(input());
    expect(d.status).toBe("APPROVED");
    expect(d.amountMinor).toBe(4000);
    expect(d.checks.map((c) => c.id)).toEqual([...CHECK_ORDER]);
    expect(d.checks.every((c) => c.status === "pass")).toBe(true);
    expect(d.checks.find((c) => c.id === "weekly_cap")!.detail).toBe(
      "week to date $40.00 + $40.00 = $80.00 of $300.00",
    );
  });

  it("takes the amount only from the rate card, ignoring anything an agent attached", () => {
    const task = { taskId: "T-102", payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1, amountMinor: 500_000, amount: "5000.00" };
    const d = decide(input({ task }));
    expect(d.amountMinor).toBe(4000);
    expect(JSON.stringify(d)).not.toContain("500000");
  });

  it("holds Ana's $150 thumbnail pack for approval", () => {
    const d = decide(input({ task: { taskId: "T-104", payeeId: "ana", rateLineId: "thumb-pack-v1", quantity: 1 }, facts: { weekToDateMinor: 8000, payeeYearToDateMinor: 0, payeeYearToDatePayments: 0, paidDecisionKeys: new Set() } }));
    expect(d.status).toBe("NEEDS_APPROVAL");
    expect(d.amountMinor).toBe(15000);
  });

  it("does not require approval at exactly the threshold", () => {
    const m = demoMandate();
    m.rateCard[0]!.amountMinor = 10000;
    expect(decide(input({ mandate: m, facts: { weekToDateMinor: 0, payeeYearToDateMinor: 0, payeeYearToDatePayments: 0, paidDecisionKeys: new Set() } })).status).toBe("APPROVED");
  });

  const blocked: Array<[string, Partial<DecideInput>, string]> = [
    ["a bad mandate signature", { mandateSignatureValid: false }, "mandate_valid"],
    ["a revoked mandate", { mandateRevoked: true }, "mandate_valid"],
    ["a time outside the window", { now: new Date("2026-11-09T00:00:00.000Z") }, "mandate_valid"],
    ["a payee not on the list", { task: { taskId: "T-9", payeeId: "mallory", rateLineId: "short-edit-v1", quantity: 1 } }, "payee_listed"],
    ["a screening match", { payee: { ...clearPayee, screening: { result: "match", listSha256: ZERO_HASH, matchedEntryId: "demo-002" } } }, "payee_cleared"],
    ["a possible screening match", { payee: { ...clearPayee, screening: { result: "review", listSha256: ZERO_HASH, matchedEntryId: "demo-002" } } }, "payee_cleared"],
    ["no tax form", { payee: { ...clearPayee, taxForm: "none" } }, "tax_form"],
    ["a failed verdict", { verdict: { seq: 13, pass: false, reasons: ["landscape 16:9; spec asks for 9:16"] } }, "verdict_pass"],
    ["an unknown rate line", { task: { taskId: "T-102", payeeId: "theo", rateLineId: "rush-fee", quantity: 1 } }, "rate_line"],
    ["a quantity over the line's maximum", { task: { taskId: "T-102", payeeId: "theo", rateLineId: "short-edit-v1", quantity: 4 } }, "rate_line"],
    ["a fractional quantity", { task: { taskId: "T-102", payeeId: "theo", rateLineId: "short-edit-v1", quantity: 1.5 } }, "rate_line"],
    ["a weekly cap overrun", { facts: { weekToDateMinor: 27000, payeeYearToDateMinor: 0, payeeYearToDatePayments: 0, paidDecisionKeys: new Set() } }, "weekly_cap"],
  ];

  it.each(blocked)("blocks %s", (_label, overrides, check) => {
    const d = decide(input(overrides));
    expect(d.status).toBe("BLOCKED");
    expect(d.blockedBy).toBe(check);
    expect(d.amountMinor).toBeUndefined();
    const failedAt = d.checks.findIndex((c) => c.status === "fail");
    expect(d.checks.slice(failedAt + 1).every((c) => c.status === "skipped")).toBe(true);
  });

  it("explains a missing tax form instead of guessing", () => {
    expect(decide(input({ payee: { ...clearPayee, taxForm: "none" } })).reason).toMatch(/backup withholding/);
  });

  it("returns ALREADY_PAID for a delivery that has a payout", () => {
    const key = decisionKey("m-maya-2026w45", "T-102", 8, 12);
    const d = decide(input({ facts: { weekToDateMinor: 0, payeeYearToDateMinor: 0, payeeYearToDatePayments: 0, paidDecisionKeys: new Set([key]) } }));
    expect(d.status).toBe("ALREADY_PAID");
    expect(d.decisionKey).toBe(key);
  });

  it("gives the same decision key for the same delivery whatever the ledger says", () => {
    const a = decide(input());
    const b = decide(input({ facts: { weekToDateMinor: 0, payeeYearToDateMinor: 0, payeeYearToDatePayments: 0, paidDecisionKeys: new Set() } }));
    expect(a.decisionKey).toBe(b.decisionKey);
    expect(a.decisionKey).toMatch(/^dk-[0-9a-f]{32}$/);
  });

  it("tracks tax thresholds without blocking", () => {
    const d = decide(input({ facts: { weekToDateMinor: 0, payeeYearToDateMinor: 198_000, payeeYearToDatePayments: 60, paidDecisionKeys: new Set() } }));
    expect(d.status).toBe("APPROVED");
    expect(d.taxMeters!.nec).toEqual({ yearToDateMinor: 202_000, thresholdMinor: 200_000, reached: true });
    expect(d.taxMeters!.k.reached).toBe(false);
    expect(d.taxMeters!.note).toMatch(/not a filing decision/);
  });
});
