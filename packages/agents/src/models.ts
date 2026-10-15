import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export type AgentRole = "ops" | "verifier" | "explainer";

/** One place for model ids. Override per role with HANDOFF_MODEL_OPS, _VERIFIER, _EXPLAINER. */
export const DEFAULT_MODEL_IDS: Record<AgentRole, string> = {
  ops: "claude-sonnet-5-5",
  verifier: "claude-haiku-5-5",
  explainer: "claude-haiku-5-5",
};

export function modelIdFor(role: AgentRole, env: NodeJS.ProcessEnv = process.env): string {
  return env[`HANDOFF_MODEL_${role.toUpperCase()}`]?.trim() || DEFAULT_MODEL_IDS[role];
}

export function anthropicModel(role: AgentRole, env: NodeJS.ProcessEnv = process.env): { model: LanguageModel; modelId: string } {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const modelId = modelIdFor(role, env);
  return { model: createAnthropic({ apiKey })(modelId), modelId };
}

/**
 * Ask Anthropic models for native structured output instead of a forced tool call;
 * current Claude models reject requests that force a specific tool.
 */
export const STRUCTURED_OUTPUT_OPTIONS = { anthropic: { structuredOutputMode: "outputFormat" } } as const;
