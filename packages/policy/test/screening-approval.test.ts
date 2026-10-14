import { describe, expect, it } from "vitest";
import { ZERO_HASH } from "@handoff/trust";
import { approvalWindow, checkApproval, type ApprovalBody } from "../src/approval.ts";
import { screenName } from "../src/screening.ts";

describe("demo screening", () => {
  it("clears ordinary names and stamps the list hash", () => {
    const r = screenName("Theo Ramirez");
    expect(r.result).toBe("clear");
    expect(r.listSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("blocks an exact match regardless of case, accents and punctuation", () => {
    expect(screenName("IVAN testcase PETROVSKY").result).toBe("match");
    expect(screenName("Ívan Testcase-Petrovsky").result).toBe("match");
    expect(screenName("Orion Placeholder Holdings, LLC").result).toBe("match");
  });

  it("sends near matches to a person", () => {
    expect(screenName("Ivan Petrovsky").result).toBe("review");
    expect(screenName("Nadia Rahimova").result).toBe("review");
  });
});

describe("approval", () => {
  const decision = { decisionHash: `sha256:${"a".repeat(64)}` as const, decisionKey: "dk-1" };
  const requested = new Date("2026-11-06T16:00:00.000Z");
  const good: ApprovalBody = { ...decision, approved: true, ...approvalWindow(requested) };

  it("accepts an approval for this exact decision inside 15 minutes", () => {
    expect(checkApproval(decision, good, new Date("2026-11-06T16:14:59.000Z"))).toEqual({ ok: true });
  });

  it.each<[string, ApprovalBody | undefined, Date]>([
    ["no approval yet", undefined, requested],
    ["a declined approval", { ...good, approved: false }, requested],
    ["an approval for another decision", { ...good, decisionHash: ZERO_HASH }, requested],
    ["an expired approval", good, new Date("2026-11-06T16:15:00.000Z")],
    ["a window longer than 15 minutes", { ...good, expiresAt: "2026-11-06T17:00:00.000Z" }, requested],
  ])("rejects %s", (_label, approval, now) => {
    expect(checkApproval(decision, approval, now).ok).toBe(false);
  });
});
