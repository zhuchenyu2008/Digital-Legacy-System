import { defineConfig } from "vitest/config";
import { workspaceAliases } from "../../vitest.aliases.js";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    name: "domain",
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/workflows/**/*.ts", "src/policies/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        branches: 100,
      },
    },
  },
});
