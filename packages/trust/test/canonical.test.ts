import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/canonical.ts";

describe("canonicalize (RFC 8785)", () => {
  it("matches the RFC 8785 §3.2.2 sample", () => {
    // Built from code points so no tool or editor can decode the escapes: backslash is 92, double quote is 34.
    const BS = String.fromCharCode(92);
    const QT = String.fromCharCode(34);
    const EURO = String.fromCharCode(0x20ac);
    const input = {
      // eslint-disable-next-line no-loss-of-precision -- the RFC sample deliberately exceeds double precision
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: EURO + "$" + String.fromCharCode(0x0f) + String.fromCharCode(0x0a) + "A'B" + QT + BS + BS + QT + "/",
      literals: [null, true, false],
    };
    const expected =
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":' +
      QT + EURO + "$" + BS + "u000f" + BS + "nA'B" + BS + QT + BS + BS + BS + BS + BS + QT + "/" + QT + "}";
    expect(canonicalize(input)).toBe(expected);
  });

  it("orders keys by UTF-16 code units (RFC 8785 §3.2.3)", () => {
    const k = (...codes: number[]) => String.fromCharCode(...codes);
    const input: Record<string, string> = {
      [k(0x20ac)]: "Euro Sign",
      [k(0x0d)]: "Carriage Return",
      [k(0xfb33)]: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      [k(0xd83d, 0xde00)]: "Emoji: Grinning Face",
      [k(0x80)]: "Control",
      [k(0xf6)]: "Latin Small Letter O With Diaeresis",
    };
    // Parsing the output back would list "1" first (JS orders integer-like keys first), so compare text.
    const order = [k(0x0d), "1", k(0x80), k(0xf6), k(0x20ac), k(0xd83d, 0xde00), k(0xfb33)];
    const expected = "{" + order.map((key) => `${JSON.stringify(key)}:${JSON.stringify(input[key])}`).join(",") + "}";
    expect(canonicalize(input)).toBe(expected);
  });

  it("is independent of insertion order", () => {
    expect(canonicalize({ b: 1, a: { d: [1, 2], c: null } })).toBe(canonicalize({ a: { c: null, d: [1, 2] }, b: 1 }));
  });

  it("skips undefined object members", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a lone surrogate", "\ud800"],
    ["undefined in an array", [1, undefined]],
    ["a Date", new Date(0)],
    ["a bigint", 1n],
  ])("rejects %s", (_label, value) => {
    expect(() => canonicalize(value)).toThrow(TypeError);
  });

  it("rejects cycles", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalize(a)).toThrow(/cyclic/);
  });
});
