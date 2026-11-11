import { EngineError } from "@handoff/engine";
import { getEngine } from "../../../../lib/engine";

export const dynamic = "force-dynamic";

/** Where one task stands: delivery, verdict, the policy decision with every check, and payout. */
export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const { engine } = await getEngine();
  try {
    return Response.json(await engine.taskStatus(taskId.slice(0, 64)), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof EngineError && e.code === "NOT_FOUND") return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
