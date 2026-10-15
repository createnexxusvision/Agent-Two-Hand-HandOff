import { bootEngine, type BootInfo, type Engine } from "@handoff/engine";
import { dispatchMode, dispatchSettle } from "./dispatch";

type Booted = { engine: Engine; info: BootInfo };

const state = globalThis as unknown as { __handoff?: Promise<Booted>; __handoffLoop?: ReturnType<typeof setInterval> };

/** One engine per server process. A failed boot is not cached, so the next request retries. */
export function getEngine(): Promise<Booted> {
  if (!state.__handoff) {
    state.__handoff = bootEngine().then(({ engine, info }) => ({ engine, info }));
    state.__handoff.catch(() => {
      state.__handoff = undefined;
    });
  }
  return state.__handoff;
}

/**
 * Inline mode: pay runs, status reads and checkpoints every 5 s in this process.
 * Render Workflows mode: a once-a-minute safety net that starts a settle run if work is waiting.
 */
export function startBackgroundLoop(): void {
  if (state.__handoffLoop) return;
  const mode = dispatchMode();
  let running = false;
  state.__handoffLoop = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { engine } = await getEngine();
      if (mode === "inline") {
        await engine.tick();
      } else {
        const jobs = await engine.config.store.jobs();
        if (jobs.some((j) => j.state === "ready" || j.state === "submitted")) await dispatchSettle(engine, "safety net");
      }
    } catch (e) {
      console.error(`background tick failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  }, mode === "inline" ? 5_000 : 60_000);
}
