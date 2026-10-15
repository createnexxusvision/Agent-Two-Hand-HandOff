import { MockLanguageModelV4 } from "ai/test";

/** A model that always answers with this exact JSON (or raw text), whatever it is asked. */
export function scriptedModel(answer: unknown) {
  const text = typeof answer === "string" ? answer : JSON.stringify(answer);
  return new MockLanguageModelV4({
    modelId: "scripted",
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

/** Everything the model was sent, flattened to one string for assertions. */
export function promptText(model: MockLanguageModelV4): string {
  return JSON.stringify(model.doGenerateCalls.map((c) => c.prompt));
}
