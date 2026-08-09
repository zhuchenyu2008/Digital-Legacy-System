import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.aliases.js";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: "node",
    // Direct directory gates share the production-like singleton constraints in one PostgreSQL
    // database. Keep files serial while each file still creates real concurrent clients.
    fileParallelism: false,
    globalSetup: ["./tests/concurrency/global-setup.ts"],
  },
});
