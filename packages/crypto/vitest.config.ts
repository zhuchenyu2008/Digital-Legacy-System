import { defineConfig } from "vitest/config";
import { workspaceAliases } from "../../vitest.aliases.js";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    name: "crypto",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
