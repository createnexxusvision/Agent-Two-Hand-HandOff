import { dispatchMode } from "../../../lib/dispatch";
import { getEngine } from "../../../lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { info } = await getEngine();
    return Response.json({ ok: true, version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local", privacy: process.env.PRIVACY ?? "off", runs: dispatchMode(), ...info });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
