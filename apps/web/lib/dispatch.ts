/**
 * Where long-running work runs. With RENDER_API_KEY and HANDOFF_WORKFLOW_SLUG set, the web app
 * hands it to Render Workflows (retries, parallel verification, per-step runs in the dashboard).
 * Otherwise, or if Render is unreachable, the same engine steps run in this process.
 */
import { Render } from "@renderinc/sdk";
import type { Engine } from "@handoff/engine";

export type DispatchMode = "render-workflows" | "inline";

function workflowSlug(): string | undefined {
  return process.env.RENDER_API_KEY?.trim() ? process.env.HANDOFF_WORKFLOW_SLUG?.trim() || undefined : undefined;
}

export function dispatchMode(): DispatchMode {
  return workflowSlug() ? "render-workflows" : "inline";
}

let client: Render | undefined;
const render = () => (client ??= new Render());

/** Runs the rest of a demo week (plan, deliver and verify, decide, settle) for a new mandate. */
export async function dispatchDemoWeek(engine: Engine, mandateId: string, useAi: boolean): Promise<string> {
  const slug = workflowSlug();
  if (slug) {
    try {
      const run = await render().workflows.startTask(`${slug}/demoWeek`, [mandateId, useAi], { idempotencyKey: `demo-${mandateId}` });
      return `running on Render Workflows (run ${run.taskRunId}); planning, parallel verification, decisions and payment appear as separate runs`;
    } catch (e) {
      console.error(`Render Workflows unavailable, running inline: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const r = await engine.runDemoWeekInline(mandateId);
  return `${r.tasks} tasks planned by ${r.planner}, checked by ${r.verifier}; payable work is paid within a few seconds`;
}

/** Pays ready work and follows it to settlement. Safe to call often. */
export async function dispatchSettle(engine: Engine, reason: string): Promise<void> {
  const slug = workflowSlug();
  if (slug) {
    try {
      // One settle run per minute at most, whatever triggers it.
      const minute = new Date().toISOString().slice(0, 16);
      await render().workflows.startTask(`${slug}/settle`, [], { idempotencyKey: `settle-${minute}` });
      return;
    } catch (e) {
      console.error(`Render Workflows unavailable for settle (${reason}), running inline: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await engine.settle({ maxMs: 0 });
}
