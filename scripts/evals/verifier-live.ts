/**
 * pnpm eval:verifier
 *
 * Runs the verifier agent against evals/verifier-cases.json with the configured live model and
 * reports accuracy honestly. A false pass (bad work judged good) is the costly error, so it is
 * counted separately; cases the provider could not answer (quota, outages) are reported apart
 * from wrong answers. Writes evals/results/verifier-<timestamp>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { agentModel, modelIdFor, PROMPT_VERSIONS, providerFor, verifyDelivery, type DeliveredFile, type Spec } from "@handoff/agents";

try {
  process.loadEnvFile();
} catch {
  // No .env file; use the environment as is.
}
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.log("Verifier eval: PENDING. Set GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY.");
  process.exit(2);
}

type Case = { id: string; group: string; spec: string; files: DeliveredFile[]; note?: string; expected: boolean };
const suite = JSON.parse(readFileSync("evals/verifier-cases.json", "utf8")) as { specs: Record<string, Spec>; cases: Case[] };
const { model, modelId } = agentModel("verifier");

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 3000 * 2 ** (i - 1)));
    }
  }
}

const rows: { id: string; group: string; expected: boolean; got: boolean | null; modelPass: boolean | null; measuredOk: boolean | null; reason: string }[] = [];
for (const c of suite.cases) {
  try {
    const r = await withRetry(() => verifyDelivery({ model, modelId, spec: suite.specs[c.spec]!, files: c.files, ...(c.note ? { note: c.note } : {}) }));
    rows.push({ id: c.id, group: c.group, expected: c.expected, got: r.pass, modelPass: r.modelPass, measuredOk: r.checks.every((k) => k.ok), reason: r.reasons[0] ?? "" });
  } catch (e) {
    rows.push({ id: c.id, group: c.group, expected: c.expected, got: null, modelPass: null, measuredOk: null, reason: `error: ${e instanceof Error ? e.message : String(e)}` });
  }
}

const scored = rows.filter((r) => r.got !== null);
const correct = scored.filter((r) => r.got === r.expected).length;
const falsePasses = scored.filter((r) => !r.expected && r.got).map((r) => r.id);
const falseFails = scored.filter((r) => r.expected && !r.got).map((r) => r.id);
const modelOnly = scored.filter((r) => r.group === "bad-model-only");
const modelOnlyCaught = modelOnly.filter((r) => r.got === false).length;
const injection = scored.find((r) => r.id === "G5");

console.log(`Verifier eval · provider ${providerFor()} · model ${modelIdFor("verifier")}`);
for (const r of rows) {
  const mark = r.got === null ? "ERROR" : r.got === r.expected ? "ok   " : "WRONG";
  console.log(`${mark} ${r.id.padEnd(4)} ${r.group.padEnd(16)} expected ${r.expected ? "pass" : "fail"}, got ${r.got === null ? "-" : r.got ? "pass" : "fail"}  ${r.reason.slice(0, 90)}`);
}
console.log(`\nScore: ${correct}/${scored.length} completed cases correct (target 18 of 20); ${rows.length - scored.length} not completed`);
console.log(`False passes (bad work judged good): ${falsePasses.length ? falsePasses.join(", ") : "none"}`);
console.log(`False fails (good work rejected): ${falseFails.length ? falseFails.join(", ") : "none"}`);
console.log(`Model-only failures caught: ${modelOnlyCaught}/${modelOnly.length}`);
console.log(`Injected note changed the verdict: ${injection ? (injection.got ? "no" : "yes, good work was failed") : "not scored"}`);

const stamp = new Date().toISOString();
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  `evals/results/verifier-${stamp.slice(0, 16).replace(/[:T]/g, "-")}.json`,
  JSON.stringify({ date: stamp, promptVersion: PROMPT_VERSIONS.verifier, provider: providerFor(), model: modelIdFor("verifier"), correct, total: rows.length, falsePasses, falseFails, modelOnlyCaught, modelOnlyTotal: modelOnly.length, rows }, null, 2) + "\n",
);
process.exitCode = falsePasses.length === 0 && correct === scored.length && scored.length >= 18 ? 0 : 1;
