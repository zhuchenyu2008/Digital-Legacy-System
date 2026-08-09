import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.aliases.js";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    projects: [
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "tooling",
          environment: "node",
          include: ["tests/tooling/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "deployment",
          environment: "node",
          include: ["tests/deployment/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "security",
          environment: "node",
          include: ["tests/security/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "contracts-drift",
          environment: "node",
          include: ["tests/contracts/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "integration",
          environment: "node",
          fileParallelism: false,
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: "unit",
          environment: "node",
          include: [
            "apps/**/*.test.ts",
            "apps/**/*.test.tsx",
            "packages/**/*.test.ts",
            "tests/architecture/**/*.test.ts",
            "tests/contracts/**/*.test.ts",
            "tests/tooling/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
        },
      },
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
    ],
  },
});
