import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { decodeBase64Url } from "../protocol/base64url.js";
import { createShareGeneration } from "./share-generation.js";

describe("share generation commitment contract", () => {
  test("binds sealed shares to the SHA-256 digest of the public VSS commitments", async () => {
    const commitments = new Uint8Array(64).fill(11);
    const generation = await createShareGeneration({
      vaultId: "vault-1",
      generationId: "generation-1",
      purpose: "recovery-share",
      threshold: 2,
      shares: [new Uint8Array(34).fill(1), new Uint8Array(34).fill(2)],
      commitments,
    });

    expect(decodeBase64Url(generation.commitmentDigest)).toEqual(
      new Uint8Array(createHash("sha256").update(commitments).digest()),
    );
  });
});
