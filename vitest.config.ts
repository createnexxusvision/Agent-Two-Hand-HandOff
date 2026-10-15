import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // Embedded Postgres (PGlite) needs a few seconds to boot on slower CI machines.
    testTimeout: 20_000,
  },
});
