export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.HANDOFF_BACKGROUND_LOOP === "off") return;
  const { startBackgroundLoop } = await import("./lib/engine");
  startBackgroundLoop();
}
