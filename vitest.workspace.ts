import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "tooling",
          environment: "node",
          include: ["tests/tooling/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "deployment",
          environment: "node",
          include: ["tests/deployment/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "contracts-drift",
          environment: "node",
          include: ["tests/contracts/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
        },
      },
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
    ],
  },
});
