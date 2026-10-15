import { readFileSync } from "node:fs";
import type { AgentRole } from "./models.ts";

/** Prompts live in packages/agents/prompts as versioned files; the version is stamped on receipts. */
export const PROMPT_VERSIONS: Record<AgentRole, string> = {
  ops: "ops-v1",
  verifier: "verifier-v2",
  explainer: "explainer-v1",
};

const cache = new Map<AgentRole, string>();

export function promptFor(role: AgentRole): { version: string; text: string } {
  const version = PROMPT_VERSIONS[role];
  let text = cache.get(role);
  if (!text) {
    text = readFileSync(new URL(`../prompts/${version}.md`, import.meta.url), "utf8").trim();
    cache.set(role, text);
  }
  return { version, text };
}
