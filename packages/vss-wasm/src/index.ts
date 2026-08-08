import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type VssSplit = Readonly<{
  shares: readonly Uint8Array[];
  commitments: Uint8Array;
}>;

type NodeWasmModule = Readonly<{
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

const nodeRequire = createRequire(import.meta.url);
const generatedNodeUrl = new URL("./node/dls_vss.js", import.meta.url);
const sourceNodeUrl = new URL("../dist/node/dls_vss.js", import.meta.url);
const nodeWasm = nodeRequire(
  fileURLToPath(existsSync(fileURLToPath(generatedNodeUrl)) ? generatedNodeUrl : sourceNodeUrl),
) as NodeWasmModule;

function copyBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value, (item) => {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
        throw new TypeError("WASM returned a non-byte value");
      }
      return item;
    });
  }
  throw new TypeError("WASM returned a non-byte buffer");
}

function normalizeSplit(value: { shares: readonly unknown[]; commitments: unknown }): VssSplit {
  return Object.freeze({
    shares: Object.freeze(value.shares.map(copyBytes)),
    commitments: copyBytes(value.commitments),
  });
}

export function splitPedersen(
  secret: Uint8Array,
  threshold: number,
  shareCount: number,
  context: Uint8Array,
): VssSplit {
  return normalizeSplit(
    nodeWasm.splitPedersen(new Uint8Array(secret), threshold, shareCount, new Uint8Array(context)),
  );
}

export function verifyPedersenShare(
  share: Uint8Array,
  commitments: Uint8Array,
  context: Uint8Array,
): boolean {
  return nodeWasm.verifyPedersenShare(
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
    nodeWasm.combinePedersen(
      shares.map((share) => new Uint8Array(share)),
      new Uint8Array(commitments),
      new Uint8Array(context),
    ),
  );
}
