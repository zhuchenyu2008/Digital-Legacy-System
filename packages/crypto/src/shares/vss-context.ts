import { encodeBase64Url } from "../protocol/base64url.js";

export type VssPurpose = "DEATH" | "RECOVERY";

export function createVssContext(
  input: Readonly<{
    vaultId: string;
    generationId: string;
    purpose: VssPurpose;
    threshold: number;
    shareCount: number;
    vkCommitment: Uint8Array;
  }>,
): Uint8Array {
  if (input.vaultId.length === 0 || input.generationId.length === 0) {
    throw new Error("VSS context IDs must be non-empty");
  }
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 2) {
    throw new Error("VSS threshold is invalid");
  }
  if (!Number.isSafeInteger(input.shareCount) || input.shareCount < input.threshold) {
    throw new Error("VSS share count is invalid");
  }
  if (!(input.vkCommitment instanceof Uint8Array) || input.vkCommitment.length !== 32) {
    throw new Error("VSS VK commitment must be 32 bytes");
  }
  return new TextEncoder().encode(
    JSON.stringify({
      generationId: input.generationId,
      protocolVersion: 1,
      purpose: input.purpose,
      shareCount: input.shareCount,
      threshold: input.threshold,
      vaultId: input.vaultId,
      vkCommitment: encodeBase64Url(input.vkCommitment),
    }),
  );
}
