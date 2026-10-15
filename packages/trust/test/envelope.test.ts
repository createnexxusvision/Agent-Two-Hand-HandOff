import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openPrivate, parseMasterKey, sealPrivate } from "../src/envelope.ts";

const master = new Uint8Array(randomBytes(32));

describe("envelope encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const env = sealPrivate("theo@example.com", master, "payee:theo");
    expect(JSON.stringify(env)).not.toContain("theo@example.com");
    expect(openPrivate(env, master, "payee:theo")).toBe("theo@example.com");
  });

  it("uses a fresh data key and IV every time", () => {
    const a = sealPrivate("same", master, "payee:theo");
    const b = sealPrivate("same", master, "payee:theo");
    expect(a.data.ct).not.toBe(b.data.ct);
    expect(a.wrapped.ct).not.toBe(b.wrapped.ct);
  });

  it("refuses an envelope moved onto another record", () => {
    const env = sealPrivate("theo@example.com", master, "payee:theo");
    expect(() => openPrivate(env, master, "payee:ana")).toThrow();
  });

  it("refuses the wrong master key and any changed byte", () => {
    const env = sealPrivate("theo@example.com", master, "payee:theo");
    expect(() => openPrivate(env, new Uint8Array(randomBytes(32)), "payee:theo")).toThrow();
    const ct = Buffer.from(env.data.ct, "base64url");
    ct[0] = ct[0]! ^ 1;
    expect(() => openPrivate({ ...env, data: { ...env.data, ct: ct.toString("base64url") } }, master, "payee:theo")).toThrow();
  });

  it("validates the master key from the environment", () => {
    expect(() => parseMasterKey(undefined)).toThrow(/not set/);
    expect(() => parseMasterKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
    expect(parseMasterKey(Buffer.alloc(32, 7).toString("base64"))).toHaveLength(32);
  });
});
