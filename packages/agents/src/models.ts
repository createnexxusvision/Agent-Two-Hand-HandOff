import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

export type AgentRole = "ops" | "verifier" | "explainer";
export type AiProvider = "google" | "anthropic";

/** One place for model ids. Override per role with HANDOFF_MODEL_OPS, _VERIFIER, _EXPLAINER. */
export const DEFAULT_MODEL_IDS: Record<AiProvider, Record<AgentRole, string>> = {
  google: { ops: "gemini-3.8-flash", verifier: "gemini-3.5-flash-lite", explainer: "gemini-3.5-flash-lite" },
  anthropic: { ops: "claude-sonnet-5-5", verifier: "claude-haiku-5-5", explainer: "claude-haiku-5-5" },
};

const KEY_VARS: Record<AiProvider, string> = { google: "GOOGLE_GENERATIVE_AI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

/** HANDOFF_AI_PROVIDER wins; otherwise Google when its key is set, else Anthropic. */
export function providerFor(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const chosen = env.HANDOFF_AI_PROVIDER?.trim().toLowerCase();
  if (chosen === "google" || chosen === "anthropic") return chosen;
  if (chosen) throw new Error(`HANDOFF_AI_PROVIDER must be "google" or "anthropic", got "${chosen}"`);
  return env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ? "google" : "anthropic";
}

export function modelIdFor(role: AgentRole, env: NodeJS.ProcessEnv = process.env): string {
  return env[`HANDOFF_MODEL_${role.toUpperCase()}`]?.trim() || DEFAULT_MODEL_IDS[providerFor(env)][role];
}

export function agentModel(role: AgentRole, env: NodeJS.ProcessEnv = process.env): { model: LanguageModel; modelId: string; provider: AiProvider } {
  const provider = providerFor(env);
  const apiKey = env[KEY_VARS[provider]]?.trim();
  if (!apiKey) throw new Error(`${KEY_VARS[provider]} is not set`);
  const modelId = modelIdFor(role, env);
  const model = provider === "google" ? createGoogleGenerativeAI({ apiKey })(modelId) : createAnthropic({ apiKey })(modelId);
  return { model, modelId, provider };
}

/**
 * Ask each provider for native structured output. For Anthropic that means an output format
 * rather than a forced tool call, which current Claude models reject.
 */
export const STRUCTURED_OUTPUT_OPTIONS = {
  anthropic: { structuredOutputMode: "outputFormat" },
  google: { structuredOutputs: true },
} as const;
