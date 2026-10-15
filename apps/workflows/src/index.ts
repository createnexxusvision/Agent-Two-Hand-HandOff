/**
 * Render Workflows tasks. Each step of the money loop runs on its own instance with its own
 * retries and timeout, and shows up as a run in the Render Dashboard. Every step is safe to
 * retry: the engine rebuilds state from receipts and skips work that already happened.
 *
 * Tasks must be registered synchronously at import time; the SDK starts the task server after.
 */
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { bootEngine, type Engine } from "@handoff/engine";

let booted: Promise<Engine> | undefined;
function engine(): Promise<Engine> {
  if (!booted) {
    booted = bootEngine().then((b) => b.engine);
    booted.catch(() => {
      booted = undefined;
    });
  }
  return booted;
}

// Model calls can hit "high demand" errors; give them room with exponential backoff.
const AI_RETRY = { maxRetries: 3, waitDurationMs: 5_000, backoffScaling: 2 };
const DB_RETRY = { maxRetries: 3, waitDurationMs: 1_000, backoffScaling: 2 };

export const planTasks = task(
  { name: "planTasks", retry: AI_RETRY, timeoutSeconds: 180 },
  async function planTasks(_ctx: TaskContext, mandateId: string, mode: "ai" | "scripted") {
    return (await engine()).planTasks(mandateId, mode);
  },
);

export const deliverAndVerify = task(
  { name: "deliverAndVerify", retry: AI_RETRY, timeoutSeconds: 120 },
  async function deliverAndVerify(_ctx: TaskContext, mandateId: string, taskId: string, mode: "ai" | "measured") {
    return (await engine()).deliverAndVerify(mandateId, taskId, mode);
  },
);

export const decide = task(
  { name: "decide", retry: DB_RETRY, timeoutSeconds: 60 },
  async function decide(_ctx: TaskContext) {
    return { decided: await (await engine()).decidePending() };
  },
);

export const settle = task(
  { name: "settle", retry: { maxRetries: 2, waitDurationMs: 10_000, backoffScaling: 2 }, timeoutSeconds: 900 },
  async function settle(_ctx: TaskContext) {
    return (await engine()).settle({ maxMs: 12 * 60_000, everyMs: 10_000 });
  },
);

export const demoWeek = task(
  { name: "demoWeek", retry: { maxRetries: 1, waitDurationMs: 5_000 }, timeoutSeconds: 1_800 },
  async function demoWeek(ctx: TaskContext, mandateId: string, useAi: boolean) {
    let plan: { taskIds: string[]; planner: string };
    let fellBack = false;
    try {
      plan = await ctx.run(planTasks, mandateId, useAi ? "ai" : "scripted");
    } catch {
      // The ops agent failed after all its retries: finish the week with the scripted plan.
      fellBack = true;
      plan = await ctx.run(planTasks, mandateId, "scripted");
    }

    // Each delivery is verified on its own instance, in parallel, with its own retries.
    const verdicts = await Promise.all(
      plan.taskIds.map(async (taskId) => {
        try {
          return await ctx.run(deliverAndVerify, mandateId, taskId, useAi ? "ai" : "measured");
        } catch {
          return ctx.run(deliverAndVerify, mandateId, taskId, "measured");
        }
      }),
    );

    const decided = await ctx.run(decide);
    const settled = await ctx.run(settle);
    return { mandateId, planner: plan.planner, plannerFellBack: fellBack, verdicts, ...decided, settled };
  },
);
