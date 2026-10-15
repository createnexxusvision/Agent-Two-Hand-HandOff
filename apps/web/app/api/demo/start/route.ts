import { EngineError } from "@handoff/engine";
import { dispatchDemoWeek } from "../../../../lib/dispatch";
import { getEngine } from "../../../../lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const back = (request: Request, msg: string) => Response.redirect(new URL(`/?msg=${encodeURIComponent(msg)}`, request.url), 303);

export async function POST(request: Request) {
  try {
    const { engine } = await getEngine();
    const { mandateId } = await engine.createDemoMandate();
    const how = await dispatchDemoWeek(engine, mandateId, engine.config.useAi);
    return back(request, `Demo week ${mandateId} started: ${how}.`);
  } catch (e) {
    if (e instanceof EngineError) return back(request, e.message);
    console.error(e);
    return back(request, "The demo could not start. Check the server log.");
  }
}
