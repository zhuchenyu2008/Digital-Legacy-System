import { describe, expect, it } from "vitest";
import { combinePedersen, splitPedersen, verifyPedersenShare } from "./index.js";

function bytes(start: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (start + index) & 0xff);
}

describe("@dls/vss-wasm node wrapper", () => {
  it("reconstructs arbitrary 32-byte secrets and verifies shares", () => {
    const secret = bytes(240);
    const context = new TextEncoder().encode("vault-01/generation-02/death");
    const split = splitPedersen(secret, 2, 3, context);
    const firstShare = split.shares[0];
    const thirdShare = split.shares[2];
    if (!firstShare || !thirdShare) throw new Error("test split did not produce three shares");

    expect(split.shares).toHaveLength(3);
    expect(verifyPedersenShare(firstShare, split.commitments, context)).toBe(true);
    expect(combinePedersen([firstShare, thirdShare], split.commitments, context)).toEqual(secret);
    expect(
      verifyPedersenShare(firstShare, split.commitments, new TextEncoder().encode("wrong")),
    ).toBe(false);
  });

  it("does not expose deterministic test-vector hooks", async () => {
    const publicExports = Object.keys(await import("./index.js"));
    expect(publicExports).not.toContain("splitPedersenTestVector");
  });
});
