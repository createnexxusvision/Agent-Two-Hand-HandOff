/**
 * "Agents propose, code pays": nothing but the pay-run executor (and the sandbox gate script)
 * may import the Payouts client. This test backs up the ESLint rule.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCAN = ["packages", "apps", "scripts"];
const ALLOWED = new Set(["packages/policy/src/execute.ts", "scripts/gates/gate1-payouts.ts"]);
const PAYOUTS_IMPORT = /from\s+["'](@handoff\/paypal\/payouts|[^"']*paypal\/src\/payouts(\.ts)?)["']|import\(\s*["'](@handoff\/paypal\/payouts|[^"']*paypal\/src\/payouts(\.ts)?)["']\s*\)/;

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(sourceFiles(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

describe("architecture", () => {
  const files = SCAN.flatMap((d) => sourceFiles(join(ROOT, d))).map((f) => relative(ROOT, f));

  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("lets only the pay-run executor import Payouts", () => {
    const offenders = files.filter((f) => !f.startsWith("packages/paypal/") && !ALLOWED.has(f) && PAYOUTS_IMPORT.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps Payouts out of the PayPal package's main entry point", () => {
    expect(readFileSync(join(ROOT, "packages/paypal/src/index.ts"), "utf8")).not.toMatch(/payouts\.ts/);
  });

  it("keeps every PayPal import out of the agents and MCP packages", () => {
    const agents = files.filter((f) => f.startsWith("packages/agents/") || f.startsWith("packages/mcp/"));
    expect(agents.length).toBeGreaterThan(5);
    const offenders = agents.filter((f) => /from\s+["'](@handoff\/paypal[^"']*|@handoff\/policy\/execute)["']/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps model calls out of the policy package", () => {
    const policy = files.filter((f) => f.startsWith("packages/policy/src/"));
    const offenders = policy.filter((f) => /from\s+["'](ai|@ai-sdk\/[^"']+|@anthropic-ai\/[^"']+|openai)["']/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("repository hygiene", () => {
  it("tracks no environment, editor swap or key files", async () => {
    const { execFileSync } = await import("node:child_process");
    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    const risky = tracked.filter((f) => {
      const name = f.split("/").pop()!;
      if (name === ".env.example") return false;
      return /^\.env(\.|$)/.test(name) || /\.env$/.test(name) || /\.sw[a-p]$/.test(name) || /~$/.test(name) || /\.(pem|key|p12|pfx)$/.test(name) || /^id_(rsa|ed25519)/.test(name);
    });
    expect(risky).toEqual([]);
  });
});
