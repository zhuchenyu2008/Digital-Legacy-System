import { defineConfig } from "vitest/config";
import { workspaceAliases } from "../../vitest.aliases.js";

export default defineConfig({
  envPrefix: ["VITE_", "DLS_", "S3_"],
  resolve: { alias: workspaceAliases },
  test: {
    name: "storage",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
