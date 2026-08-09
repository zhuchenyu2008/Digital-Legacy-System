import { defineConfig } from "vitest/config";
import { workspaceAliases } from "../../vitest.aliases.js";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  oxc: false,
  resolve: { alias: workspaceAliases },
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
