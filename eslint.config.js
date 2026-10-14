import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Only the pay-run executor in packages/policy may reach the Payouts client.
// The gate script is the one sanctioned exception: it exercises the sandbox API directly.
const PAYOUTS_ALLOWED = [
  "packages/policy/src/execute.ts",
  "packages/paypal/**",
  "scripts/gates/gate1-payouts.ts",
];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/managed/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@handoff/paypal/payouts",
              message: "Agents propose, code pays: only packages/policy/src/execute.ts may call Payouts.",
            },
          ],
          patterns: [
            {
              group: ["**/paypal/src/payouts", "**/paypal/src/payouts.ts"],
              message: "Agents propose, code pays: only packages/policy/src/execute.ts may call Payouts.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: PAYOUTS_ALLOWED,
    rules: { "no-restricted-imports": "off" },
  },
);
