import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "crypto",
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
