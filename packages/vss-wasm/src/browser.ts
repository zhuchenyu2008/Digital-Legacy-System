import type { VssSplit } from "./index.js";

type BrowserWasmModule = Readonly<{
  default: () => Promise<unknown>;
  splitPedersen: (
    secret: Uint8Array,
    threshold: number,
    shareCount: number,
    context: Uint8Array,
  ) => { shares: readonly unknown[]; commitments: unknown };
  verifyPedersenShare: (share: Uint8Array, commitments: Uint8Array, context: Uint8Array) => boolean;
  combinePedersen: (
    shares: readonly Uint8Array[],
    commitments: Uint8Array,
    context: Uint8Array,
  ) => Uint8Array;
}>;

let wasm: BrowserWasmModule | undefined;

export async function initializeBrowser(): Promise<void> {
  let module: BrowserWasmModule;
  try {
    module = (await import(
      new URL("./browser/dls_vss.js", import.meta.url).href
    )) as BrowserWasmModule;
  } catch {
    module = (await import(
      new URL("../dist/browser/dls_vss.js", import.meta.url).href
    )) as BrowserWasmModule;
  }
  await module.default();
  wasm = module;
}

function ready(): BrowserWasmModule {
  if (!wasm) {
    throw new Error("@dls/vss-wasm browser module is not initialized");
  }
  return wasm;
}

function copyBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new TypeError("WASM returned a non-byte buffer");
}

export function splitPedersen(
  secret: Uint8Array,
  threshold: number,
  shareCount: number,
  context: Uint8Array,
): VssSplit {
  const result = ready().splitPedersen(
    new Uint8Array(secret),
    threshold,
    shareCount,
    new Uint8Array(context),
  );
  return Object.freeze({
    shares: Object.freeze(result.shares.map(copyBytes)),
    commitments: copyBytes(result.commitments),
  });
}

export function verifyPedersenShare(
  share: Uint8Array,
  commitments: Uint8Array,
  context: Uint8Array,
): boolean {
  return ready().verifyPedersenShare(
    new Uint8Array(share),
    new Uint8Array(commitments),
    new Uint8Array(context),
  );
}

export function combinePedersen(
  shares: readonly Uint8Array[],
  commitments: Uint8Array,
  context: Uint8Array,
): Uint8Array {
  return new Uint8Array(
    ready().combinePedersen(
      shares.map((share) => new Uint8Array(share)),
      new Uint8Array(commitments),
      new Uint8Array(context),
    ),
  );
}
