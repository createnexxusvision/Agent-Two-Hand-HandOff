import { EngineError } from "@handoff/engine";
import { dispatchSettle } from "../../../lib/dispatch";
import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";

const back = (request: Request, msg: string) => Response.redirect(new URL(`/?msg=${encodeURIComponent(msg)}`, request.url), 303);

export async function POST(request: Request) {
  const form = await request.formData();
  const key = String(form.get("decisionKey") ?? "");
  const choice = String(form.get("choice") ?? "");
  if (!/^dk-[0-9a-f]{32}$/.test(key) || (choice !== "approve" && choice !== "decline")) return back(request, "That approval request was not valid.");
  try {
    const { engine } = await getEngine();
    await engine.approve(key, choice === "approve");
    if (choice === "approve") await dispatchSettle(engine, "approval");
    return back(request, choice === "approve" ? "Approved. The approval signs this exact decision and expires in 15 minutes." : "Declined. Nothing will be paid for it.");
  } catch (e) {
    if (e instanceof EngineError) return back(request, e.message);
    console.error(e);
    return back(request, "The approval could not be recorded. Check the server log.");
  }
}
