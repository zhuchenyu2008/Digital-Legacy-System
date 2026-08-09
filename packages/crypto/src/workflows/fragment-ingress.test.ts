import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { generateContactKeyPair } from "../keys/contact-key-pair.js";
import { decodeBase64Url, encodeBase64Url } from "../protocol/base64url.js";
import {
  type FragmentIngressExpected,
  openFragmentIngressV1,
  sealFragmentIngressV1,
} from "./fragment-ingress.js";
import { openStageFragmentV1, wrapStageFragmentV1 } from "./stage-wrapping.js";

const metadata = {
  workflowId: "workflow-0194",
  contactId: "contact-0194",
  generationId: "generation-0194",
  shareIndex: 2,
  purpose: "DEATH" as const,
  commitmentDigest: encodeBase64Url(Uint8Array.from({ length: 32 }, (_, index) => index)),
  ingressKeyVersion: 7,
};

const expected: FragmentIngressExpected = metadata;
const share = Uint8Array.from({ length: 34 }, (_, index) => (index + 17) & 0xff);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function tamper(value: string): string {
  const bytes = decodeBase64Url(value);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
  return encodeBase64Url(bytes);
}

describe("workflow fragment ingress v1", () => {
  it("validates a configured X25519 pair in a cold process", () => {
    const pair = generateKeyPairSync("x25519");
    const publicKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x ?? "", "base64url");
    const privateKey = Buffer.from(pair.privateKey.export({ format: "jwk" }).d ?? "", "base64url");
    const moduleUrl = pathToFileURL(
      resolve(workspaceRoot, "packages/crypto/src/workflows/fragment-ingress.ts"),
    ).href;
    const program = `
      import { assertX25519KeyPair } from ${JSON.stringify(moduleUrl)};
      await assertX25519KeyPair({
        publicKey: Buffer.from(${JSON.stringify(publicKey.toString("base64"))}, "base64"),
        privateKey: Buffer.from(${JSON.stringify(privateKey.toString("base64"))}, "base64")
      });
    `;

    expect(() =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", program],
        {
          cwd: workspaceRoot,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    ).not.toThrow();
  });

  it("round-trips a share while binding every workflow context field", async () => {
    const recipient = await generateContactKeyPair();
    const envelope = await sealFragmentIngressV1({
      ...metadata,
      share,
      recipientPublicKey: recipient.publicKey,
    });

    await expect(
      openFragmentIngressV1({ envelope, recipientKeyPair: recipient, expected }),
    ).resolves.toEqual(share);

    for (const changed of [
      { workflowId: "stale-workflow" },
      { contactId: "other-contact" },
      { generationId: "stale-generation" },
      { shareIndex: 3 },
      { purpose: "RECOVERY" as const },
      { commitmentDigest: encodeBase64Url(new Uint8Array(32).fill(9)) },
      { ingressKeyVersion: 8 },
    ]) {
      await expect(
        openFragmentIngressV1({
          envelope,
          recipientKeyPair: recipient,
          expected: { ...expected, ...changed },
        }),
      ).rejects.toThrow(/context/i);
    }
  });

  it("rejects wrong process keys, protocol versions, nonce corruption, and ciphertext corruption", async () => {
    const recipient = await generateContactKeyPair();
    const wrongProcess = await generateContactKeyPair();
    const envelope = await sealFragmentIngressV1({
      ...metadata,
      share,
      recipientPublicKey: recipient.publicKey,
    });

    await expect(
      openFragmentIngressV1({ envelope, recipientKeyPair: wrongProcess, expected }),
    ).rejects.toThrow();
    await expect(
      openFragmentIngressV1({
        envelope: { ...envelope, protocolVersion: 2 } as never,
        recipientKeyPair: recipient,
        expected,
      }),
    ).rejects.toThrow();
    await expect(
      openFragmentIngressV1({
        envelope: { ...envelope, nonce: tamper(envelope.nonce) },
        recipientKeyPair: recipient,
        expected,
      }),
    ).rejects.toThrow();
    await expect(
      openFragmentIngressV1({
        envelope: { ...envelope, ciphertext: tamper(envelope.ciphertext) },
        recipientKeyPair: recipient,
        expected,
      }),
    ).rejects.toThrow();
  });

  it("stage-wraps validated shares and rejects purpose, key, version, and context replay", async () => {
    const stageKey = Uint8Array.from({ length: 32 }, (_, index) => (index + 71) & 0xff);
    const envelope = await wrapStageFragmentV1({
      ...metadata,
      stageKeyVersion: 11,
      share,
      stageKey,
    });
    const stageExpected = { ...metadata, stageKeyVersion: 11 };

    await expect(
      openStageFragmentV1({ envelope, stageKey, expected: stageExpected }),
    ).resolves.toEqual(share);
    await expect(
      openStageFragmentV1({
        envelope,
        stageKey: new Uint8Array(32).fill(4),
        expected: stageExpected,
      }),
    ).rejects.toThrow();

    for (const changed of [
      { workflowId: "other-workflow" },
      { purpose: "RECOVERY" as const },
      { stageKeyVersion: 12 },
    ]) {
      await expect(
        openStageFragmentV1({
          envelope,
          stageKey,
          expected: { ...stageExpected, ...changed },
        }),
      ).rejects.toThrow(/context/i);
    }

    await expect(
      openStageFragmentV1({
        envelope: { ...envelope, ciphertext: tamper(envelope.ciphertext) },
        stageKey,
        expected: stageExpected,
      }),
    ).rejects.toThrow();
  });
});
