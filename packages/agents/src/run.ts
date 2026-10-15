import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import type { z } from "zod";
import { STRUCTURED_OUTPUT_OPTIONS } from "./models.ts";

export class AgentOutputRejected extends Error {
  constructor(
    readonly agent: string,
    readonly problems: string[],
  ) {
    super(`${agent} output rejected: ${problems.join("; ")}`);
    this.name = "AgentOutputRejected";
  }
}

/** One structured call. A response that fails the schema is rejected, not retried more loosely. */
export async function structuredCall<S extends z.ZodType>(input: {
  agent: string;
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: S;
  name: string;
  abortSignal?: AbortSignal;
}): Promise<z.infer<S>> {
  try {
    const result = await generateText({
      model: input.model,
      system: input.system,
      prompt: input.prompt,
      output: Output.object({ schema: input.schema, name: input.name }),
      providerOptions: STRUCTURED_OUTPUT_OPTIONS,
      maxRetries: 1,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    return result.output as z.infer<S>;
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) {
      throw new AgentOutputRejected(input.agent, [`response did not match the ${input.name} schema`]);
    }
    throw e;
  }
}
