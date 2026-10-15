import type { LanguageModel } from "ai";
import { promptFor } from "./prompts.ts";
import { structuredCall } from "./run.ts";
import { VerdictSchema, type Spec } from "./schemas.ts";
import { cleanText, untrusted } from "./untrusted.ts";

export type DeliveredFile = { name: string; width?: number; height?: number; durationS?: number; count?: number };
export type MeasuredCheck = { name: string; ok: boolean; detail: string };

export type VerifierResult = {
  pass: boolean;
  /** Code-measured failures first, then the model's reasons. Treat as untrusted text downstream. */
  reasons: string[];
  checks: MeasuredCheck[];
  modelPass: boolean;
  confidence: number;
  modelId: string;
  promptVersion: string;
};

const RATIOS: Record<NonNullable<Spec["aspect"]>, number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1, "4:5": 4 / 5 };

function describeRatio(w: number, h: number): string {
  const r = w / h;
  const named = Object.entries(RATIOS).find(([, v]) => Math.abs(v - r) < 0.01)?.[0];
  return named ? `${named} (${w}×${h})` : `${w}×${h}`;
}

/** Facts code can measure. A delivery cannot pass if any of these fail, whatever a model says. */
export function measure(spec: Spec, files: readonly DeliveredFile[]): MeasuredCheck[] {
  const checks: MeasuredCheck[] = [];
  if (spec.fileCount !== null) {
    const count = files.reduce((n, f) => n + (f.count ?? 1), 0);
    checks.push({ name: "file count", ok: count === spec.fileCount, detail: `${count} file(s); spec asks for ${spec.fileCount}` });
  }
  for (const f of files) {
    const label = cleanText(f.name, 120);
    if (spec.aspect !== null && f.width && f.height) {
      const ok = Math.abs(f.width / f.height - RATIOS[spec.aspect]) < 0.01;
      checks.push({ name: `aspect ratio · ${label}`, ok, detail: `${describeRatio(f.width, f.height)}; spec asks for ${spec.aspect}` });
    }
    if (spec.maxDurationS !== null && f.durationS !== undefined) {
      checks.push({ name: `duration · ${label}`, ok: f.durationS <= spec.maxDurationS, detail: `${f.durationS} s; spec allows ${spec.maxDurationS} s` });
    }
    if (spec.minWidth !== null && f.width) {
      checks.push({ name: `width · ${label}`, ok: f.width >= spec.minWidth, detail: `${f.width} px; spec asks for at least ${spec.minWidth}` });
    }
  }
  return checks;
}

export async function verifyDelivery(input: {
  model: LanguageModel;
  modelId: string;
  spec: Spec;
  files: readonly DeliveredFile[];
  note?: string;
}): Promise<VerifierResult> {
  const prompt = promptFor("verifier");
  const checks = measure(input.spec, input.files);
  const verdict = await structuredCall({
    agent: "verifier",
    model: input.model,
    system: prompt.text,
    prompt: [
      `Spec (trusted):\n${JSON.stringify(input.spec, null, 2)}`,
      `Measurements computed by code (trusted):\n${JSON.stringify(checks, null, 2)}`,
      `File names:\n${untrusted("file_names", input.files.map((f) => f.name).join("\n"))}`,
      input.note ? `Contractor's note:\n${untrusted("delivery_note", input.note)}` : "The contractor left no note.",
    ].join("\n\n"),
    schema: VerdictSchema,
    name: "verdict",
  });
  const failed = checks.filter((c) => !c.ok);
  return {
    pass: verdict.pass && failed.length === 0,
    reasons: [...failed.map((c) => `${c.name}: ${c.detail}`), ...verdict.reasons.map((r) => cleanText(r, 240))],
    checks,
    modelPass: verdict.pass,
    confidence: verdict.confidence,
    modelId: input.modelId,
    promptVersion: prompt.version,
  };
}
