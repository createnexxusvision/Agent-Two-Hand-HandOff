import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Locally, read the repo-root .env (Next only looks in apps/web). On Render, variables come from the dashboard.
const rootEnv = resolve(process.cwd(), "../../.env");
if (!process.env.RENDER && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  transpilePackages: ["@handoff/mcp", "@handoff/engine", "@handoff/agents", "@handoff/db", "@handoff/paypal", "@handoff/policy", "@handoff/trust"],
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
};

export default config;
