import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WRAPPED_KEY_ALGORITHM } from "../protocol/algorithms.js";
import { decodeBase64Url, encodeBase64Url } from "../protocol/base64url.js";
import { openShareV1 } from "../shares/share-envelope.js";
import { createShareGeneration, sealShareGeneration } from "../shares/share-generation.js";
import {
  generateContactKeyPair,
  unwrapContactPrivateKey,
  wrapContactPrivateKey,
} from "./contact-key-pair.js";
import { commitVaultKey, generateVaultKey } from "./key-material.js";
import { unwrapKeyV1, wrapKeyV1 } from "./key-wrapping.js";

const vaultId = "vault-keys-test";
const packageId = "package-keys-test";
const contactId = "contact-keys-test";

const keyVector = JSON.parse(
  readFileSync(new URL("../../vectors/keys-v1.json", import.meta.url), "utf8"),
) as {
  testOnly: boolean;
  version: number;
  vaultKeyCommitment: { vaultKey: string; commitment: string };
};

function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) & 0xff);
}

describe("vault and contact key hierarchy v1", () => {
  it("generates a 32-byte VK and a stable generichash commitment", async () => {
    const first = await generateVaultKey();
    const second = await generateVaultKey();

    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
    expect(await commitVaultKey(first)).toEqual(await commitVaultKey(new Uint8Array(first)));
    expect(await commitVaultKey(first)).not.toEqual(await commitVaultKey(second));
  });

  it("matches the committed non-secret VK commitment vector", async () => {
    expect(keyVector.testOnly).toBe(true);
    expect(keyVector.version).toBe(1);
    expect(await commitVaultKey(decodeBase64Url(keyVector.vaultKeyCommitment.vaultKey))).toEqual(
      decodeBase64Url(keyVector.vaultKeyCommitment.commitment),
    );
  });

  it("keeps the browser and Node facades interoperable", async () => {
    const browser = await import("../browser.js");
    const node = await import("../node.js");
    const vaultKey = await browser.generateVaultKey();
    expect(await node.commitVaultKey(vaultKey)).toEqual(await browser.commitVaultKey(vaultKey));
  });

  it("wraps and unwraps the owner VK with purpose-separated AAD", async () => {
    const vk = await generateVaultKey();
    const ownerKek = bytes(32, 11);
    const envelope = await wrapKeyV1({
      key: vk,
      wrappingKey: ownerKek,
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "owner-vk",
        vaultId,
        keyId: "owner-kek-1",
        algorithm: WRAPPED_KEY_ALGORITHM,
      },
    });

    await expect(
      unwrapKeyV1({
        envelope,
        wrappingKey: ownerKek,
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "owner-vk",
          vaultId,
          keyId: "owner-kek-1",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).resolves.toEqual(vk);

    await expect(
      unwrapKeyV1({
        envelope,
        wrappingKey: bytes(32, 12),
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "owner-vk",
          vaultId,
          keyId: "owner-kek-1",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).rejects.toThrow();
    await expect(
      unwrapKeyV1({
        envelope: { ...envelope, version: 2 } as never,
        wrappingKey: ownerKek,
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "owner-vk",
          vaultId,
          keyId: "owner-kek-1",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).rejects.toThrow();
    await expect(
      unwrapKeyV1({
        envelope,
        wrappingKey: ownerKek,
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "package-dek",
          vaultId,
          packageId,
          packageVersion: 1,
          keyId: "owner-kek-1",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).rejects.toThrow();
  });

  it("wraps a contact private key under CONTACT_KEK and binds its public key id", async () => {
    const contact = await generateContactKeyPair();
    const contactKek = bytes(32, 23);
    const envelope = await wrapContactPrivateKey({
      privateKey: contact.privateKey,
      publicKey: contact.publicKey,
      contactKek,
      vaultId,
      contactId,
    });

    await expect(
      unwrapContactPrivateKey({
        envelope,
        publicKey: contact.publicKey,
        contactKek,
        vaultId,
        contactId,
      }),
    ).resolves.toEqual(contact.privateKey);
    await expect(
      unwrapContactPrivateKey({
        envelope,
        publicKey: bytes(32, 99),
        contactKek,
        vaultId,
        contactId,
      }),
    ).rejects.toThrow();
  });

  it("seals shares and rejects wrong contact, generation, purpose, and ciphertext", async () => {
    const contact = await generateContactKeyPair();
    const otherContact = await generateContactKeyPair();
    const thirdContact = await generateContactKeyPair();
    const commitment = await commitVaultKey(bytes(32, 41));
    const generation = await createShareGeneration({
      vaultId,
      generationId: "death-generation-1",
      purpose: "death-share",
      threshold: 2,
      shares: [bytes(34, 1), bytes(34, 2), bytes(34, 3)],
      commitments: commitment,
    });
    const [envelope] = await sealShareGeneration({
      generation,
      contacts: [
        { contactId, publicKey: contact.publicKey },
        { contactId: "contact-keys-test-2", publicKey: otherContact.publicKey },
        { contactId: "contact-keys-test-3", publicKey: thirdContact.publicKey },
      ],
    });
    if (envelope === undefined) throw new Error("expected one sealed share");

    await expect(
      openShareV1({
        envelope,
        keyPair: contact,
        expected: {
          vaultId,
          generationId: "death-generation-1",
          purpose: "death-share",
          contactId,
        },
      }),
    ).resolves.toEqual(bytes(34, 1));
    await expect(
      openShareV1({
        envelope,
        keyPair: otherContact,
        expected: {
          vaultId,
          generationId: "death-generation-1",
          purpose: "death-share",
          contactId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      openShareV1({
        envelope,
        keyPair: contact,
        expected: {
          vaultId,
          generationId: "recovery-generation-1",
          purpose: "recovery-share",
          contactId,
        },
      }),
    ).rejects.toThrow();

    const tamperedCiphertext = decodeBase64Url(envelope.ciphertext);
    tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
    await expect(
      openShareV1({
        envelope: { ...envelope, ciphertext: encodeBase64Url(tamperedCiphertext) },
        keyPair: contact,
        expected: {
          vaultId,
          generationId: "death-generation-1",
          purpose: "death-share",
          contactId,
        },
      }),
    ).rejects.toThrow();
  });

  it("uses the public commitment digest across share purposes and wraps package DEKs", async () => {
    const commitments = await commitVaultKey(bytes(32, 71));
    const death = await createShareGeneration({
      vaultId,
      generationId: "death-generation-2",
      purpose: "death-share",
      threshold: 2,
      shares: [bytes(34, 8), bytes(34, 9)],
      commitments,
    });
    const recovery = await createShareGeneration({
      vaultId,
      generationId: "recovery-generation-2",
      purpose: "recovery-share",
      threshold: 2,
      shares: [bytes(34, 8), bytes(34, 9)],
      commitments,
    });
    expect(death.commitmentDigest).toBe(recovery.commitmentDigest);

    const dek = bytes(32, 121);
    const packageKek = bytes(32, 131);
    const envelope = await wrapKeyV1({
      key: dek,
      wrappingKey: packageKek,
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "package-dek",
        vaultId,
        packageId,
        packageVersion: 7,
        keyId: "package-kek-7",
        algorithm: WRAPPED_KEY_ALGORITHM,
      },
    });
    await expect(
      unwrapKeyV1({
        envelope,
        wrappingKey: packageKek,
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "package-dek",
          vaultId,
          packageId,
          packageVersion: 7,
          keyId: "package-kek-7",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).resolves.toEqual(dek);
    await expect(
      unwrapKeyV1({
        envelope,
        wrappingKey: packageKek,
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "package-dek",
          vaultId,
          packageId,
          packageVersion: 8,
          keyId: "package-kek-7",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).rejects.toThrow();
  });

  it("supports rotation by adding a new wrap while preserving commitments and sealed shares", async () => {
    const vk = await generateVaultKey();
    const commitmentBefore = await commitVaultKey(vk);
    const oldOwnerWrap = await wrapKeyV1({
      key: vk,
      wrappingKey: bytes(32, 151),
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "owner-vk",
        vaultId,
        keyId: "owner-kek-old",
        algorithm: WRAPPED_KEY_ALGORITHM,
      },
    });
    await expect(
      wrapKeyV1({
        key: vk,
        wrappingKey: bytes(31, 152),
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "owner-vk",
          vaultId,
          keyId: "owner-kek-new",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).rejects.toThrow();
    await expect(
      unwrapKeyV1({
        envelope: oldOwnerWrap,
        wrappingKey: bytes(32, 151),
        aad: {
          protocol: "dls-crypto-v1",
          version: 1,
          purpose: "owner-vk",
          vaultId,
          keyId: "owner-kek-old",
          algorithm: WRAPPED_KEY_ALGORITHM,
        },
      }),
    ).resolves.toEqual(vk);
    expect(await commitVaultKey(vk)).toEqual(commitmentBefore);

    const contact = await generateContactKeyPair();
    const sealedShares = await sealShareGeneration({
      generation: await createShareGeneration({
        vaultId,
        generationId: "contact-rotation-generation",
        purpose: "recovery-share",
        threshold: 2,
        shares: [bytes(34, 201), bytes(34, 202)],
        commitments: commitmentBefore,
      }),
      contacts: [
        { contactId, publicKey: contact.publicKey },
        { contactId: "contact-rotation-2", publicKey: (await generateContactKeyPair()).publicKey },
      ],
    });
    const sealedSharesSnapshot = JSON.stringify(sealedShares);
    const publicKeySnapshot = new Uint8Array(contact.publicKey);
    const contactWrap = await wrapContactPrivateKey({
      privateKey: contact.privateKey,
      publicKey: contact.publicKey,
      contactKek: bytes(32, 161),
      vaultId,
      contactId,
    });
    const rotatedContactWrap = await wrapContactPrivateKey({
      privateKey: contact.privateKey,
      publicKey: contact.publicKey,
      contactKek: bytes(32, 162),
      vaultId,
      contactId,
    });
    expect(rotatedContactWrap).not.toEqual(contactWrap);
    await expect(
      unwrapContactPrivateKey({
        envelope: rotatedContactWrap,
        publicKey: contact.publicKey,
        contactKek: bytes(32, 162),
        vaultId,
        contactId,
      }),
    ).resolves.toEqual(contact.privateKey);
    expect(contact.publicKey).toEqual(publicKeySnapshot);
    expect(JSON.stringify(sealedShares)).toBe(sealedSharesSnapshot);
  });
});
