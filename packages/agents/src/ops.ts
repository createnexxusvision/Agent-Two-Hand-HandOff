import type { LanguageModel } from "ai";
import { findPayee, findRateLine, type LaborMandate } from "@handoff/policy";
import { promptFor } from "./prompts.ts";
import { AgentOutputRejected, structuredCall } from "./run.ts";
import { OpsPlanSchema, type OpsPlan } from "./schemas.ts";
import { untrusted } from "./untrusted.ts";

export type OpsResult = {
  tasks: OpsPlan["tasks"];
  /** Messages with the AI disclosure added by code, never left to the model. */
  messages: { payeeId: string; text: string }[];
  modelId: string;
  promptVersion: string;
};

export function aiDisclosure(principalName: string): string {
  return `Hi, I'm an AI assistant working for ${principalName.replace(/\.+$/, "")}.`;
}

/** The agent sees payees and rate lines but no amounts: it cannot reason about money it never sees. */
export function mandateForOps(m: LaborMandate) {
  return {
    principal: m.principal.displayName,
    window: { from: m.validFrom.slice(0, 10), until: m.validUntil.slice(0, 10) },
    payees: m.payees.map((p) => ({ id: p.id, name: p.displayName })),
    rateLines: m.rateCard.map((l) => ({ id: l.id, description: l.description, unit: l.unit, maxQuantity: l.maxQuantity })),
  };
}

/** Plain-code checks on a schema-valid plan. Any problem rejects the whole plan. */
export function checkPlan(plan: OpsPlan, mandate: LaborMandate): string[] {
  const problems: string[] = [];
  for (const [i, t] of plan.tasks.entries()) {
    if (!findPayee(mandate, t.payeeId)) problems.push(`task ${i + 1}: ${t.payeeId} is not a payee on the mandate`);
    const line = findRateLine(mandate, t.rateLineId);
    if (!line) problems.push(`task ${i + 1}: ${t.rateLineId} is not a rate line on the mandate`);
    else if (t.quantity > line.maxQuantity) problems.push(`task ${i + 1}: quantity ${t.quantity} exceeds ${line.maxQuantity} for ${line.id}`);
  }
  for (const m of plan.messages) {
    if (!findPayee(mandate, m.payeeId)) problems.push(`message to ${m.payeeId}, who is not a payee on the mandate`);
  }
  return problems;
}

export async function proposeTasks(input: {
  model: LanguageModel;
  modelId: string;
  mandate: LaborMandate;
  goal: string;
  today: string;
}): Promise<OpsResult> {
  const prompt = promptFor("ops");
  const plan = await structuredCall({
    agent: "ops",
    model: input.model,
    system: prompt.text,
    prompt: [
      `Today is ${input.today}.`,
      `Mandate (trusted):\n${JSON.stringify(mandateForOps(input.mandate), null, 2)}`,
      `The creator's goal for the week:\n${untrusted("creator_goal", input.goal)}`,
    ].join("\n\n"),
    schema: OpsPlanSchema,
    name: "task_plan",
  });
  const problems = checkPlan(plan, input.mandate);
  if (problems.length) throw new AgentOutputRejected("ops", problems);
  const disclosure = aiDisclosure(input.mandate.principal.displayName);
  return {
    tasks: plan.tasks,
    messages: plan.messages.map((m) => ({ payeeId: m.payeeId, text: `${disclosure} ${m.text}` })),
    modelId: input.modelId,
    promptVersion: prompt.version,
  };
}
