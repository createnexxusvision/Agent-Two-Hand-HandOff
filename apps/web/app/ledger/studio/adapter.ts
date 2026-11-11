/**
 * AG Studio's LLM adapter for HandOff. Studio calls executeTurn once per model turn; this posts the
 * turn to the site's own /api/studio/llm, which holds the model key and answers with
 * newline-delimited JSON: one {"event"} per AG-UI event, then one {"complete"} with the response.
 */
import type { AgAiEvent, AgLlmAdapter, AgLlmResponse } from "ag-studio";

const failed = (code: string, message: string): AgLlmResponse => ({ id: `failed-${Date.now()}`, createdAt: Date.now(), status: "failed", output: [], error: { code, message } });

export function handoffAdapter(endpoint = "/api/studio/llm"): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const queue: AgAiEvent[] = [];
      const waiting: { wake: (() => void) | null } = { wake: null };
      let done = false;
      let finish!: (response: AgLlmResponse) => void;
      const complete = new Promise<AgLlmResponse>((resolve) => (finish = resolve));
      const push = (event: AgAiEvent) => {
        queue.push(event);
        waiting.wake?.();
      };

      void (async () => {
        let response: AgLlmResponse | null = null;
        try {
          const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: options?.signal });
          if (!res.ok || !res.body) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            response = failed(res.status === 429 ? "rate_limited" : `http_${res.status}`, body.error ?? `The assistant is unavailable (HTTP ${res.status}).`);
          } else {
            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = "";
            for (;;) {
              const { value, done: ended } = await reader.read();
              if (value) buffer += value;
              let nl: number;
              while ((nl = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line) continue;
                const msg = JSON.parse(line) as { event?: AgAiEvent; complete?: AgLlmResponse };
                if (msg.event) push(msg.event);
                if (msg.complete) response = msg.complete;
              }
              if (ended) break;
            }
          }
        } catch (e) {
          response = options?.signal?.aborted ? failed("cancelled", "The run was cancelled.") : failed("network", e instanceof Error ? e.message : String(e));
        }
        // A failed turn carries its reason on the response; Studio shows it in the chat panel.
        done = true;
        waiting.wake?.();
        finish(response ?? failed("empty", "The turn ended without a response."));
      })();

      const stream = {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (queue.length) {
              yield queue.shift()!;
              continue;
            }
            if (done) return;
            await new Promise<void>((resolve) => (waiting.wake = resolve));
            waiting.wake = null;
          }
        },
      };
      return { stream, complete };
    },
  };
}
