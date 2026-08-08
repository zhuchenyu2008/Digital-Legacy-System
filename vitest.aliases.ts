import { fileURLToPath } from "node:url";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const workspaceAliases = [
  { find: "@dls/crypto/browser", replacement: source("./packages/crypto/src/browser.ts") },
  { find: "@dls/crypto/node", replacement: source("./packages/crypto/src/node.ts") },
  { find: "@dls/vss-wasm/browser", replacement: source("./packages/vss-wasm/src/browser.ts") },
  { find: "@dls/vss-wasm/node", replacement: source("./packages/vss-wasm/src/node.ts") },
  { find: "@dls/application", replacement: source("./packages/application/src/index.ts") },
  { find: "@dls/contracts", replacement: source("./packages/contracts/src/index.ts") },
  { find: "@dls/crypto", replacement: source("./packages/crypto/src/index.ts") },
  { find: "@dls/domain", replacement: source("./packages/domain/src/index.ts") },
  { find: "@dls/email-templates", replacement: source("./packages/email-templates/src/index.ts") },
  { find: "@dls/persistence", replacement: source("./packages/persistence/src/index.ts") },
  { find: "@dls/storage", replacement: source("./packages/storage/src/index.ts") },
  { find: "@dls/test-fixtures", replacement: source("./packages/test-fixtures/src/index.ts") },
  { find: "@dls/vss-wasm", replacement: source("./packages/vss-wasm/src/index.ts") },
] as const;
