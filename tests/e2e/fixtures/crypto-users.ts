import {
  type ContactKeyPair,
  createShareGeneration,
  createVaultKeyMaterial,
  createVssContext,
  generateContactKeyPair,
  generateVaultKey,
  type ShareEnvelopeV1,
  sealShareGeneration,
  type WrappedKeyV1,
  wrapContactPrivateKey,
} from "../../../packages/crypto/dist/node.js";
import { splitPedersen } from "../../../packages/vss-wasm/dist/index.js";

const ids = Object.freeze({
  vault: "00000000-0000-4000-8000-00000000e001",
  deathGeneration: "00000000-0000-4000-8000-00000000e002",
  recoveryGeneration: "00000000-0000-4000-8000-00000000e003",
  package: "00000000-0000-4000-8000-00000000e004",
  contacts: [
    "00000000-0000-4000-8000-00000000e011",
    "00000000-0000-4000-8000-00000000e012",
    "00000000-0000-4000-8000-00000000e013",
  ],
});

export type CryptoContact = Readonly<{
  contactId: string;
  email: string;
  password: string;
  keyPair: ContactKeyPair;
  contactKek: Uint8Array;
  wrappedPrivateKey: WrappedKeyV1;
}>;

export type CryptoGeneration = Readonly<{
  generationId: string;
  context: Uint8Array;
  shares: readonly Uint8Array[];
  commitments: Uint8Array;
  envelopes: readonly ShareEnvelopeV1[];
}>;

export type CryptoUsers = Readonly<{
  owner: Readonly<{ email: string; password: string }>;
  vaultId: string;
  packageId: string;
  vaultKey: Uint8Array;
  vkCommitment: Uint8Array;
  contacts: readonly CryptoContact[];
  deathGeneration: CryptoGeneration;
  recoveryGeneration: CryptoGeneration;
}>;

async function generation(
  purpose: "DEATH" | "RECOVERY",
  generationId: string,
  vaultKey: Uint8Array,
  vkCommitment: Uint8Array,
  contacts: readonly CryptoContact[],
): Promise<CryptoGeneration> {
  const context = createVssContext({
    vaultId: ids.vault,
    generationId,
    purpose,
    threshold: 2,
    shareCount: contacts.length,
    vkCommitment,
  });
  const split = splitPedersen(vaultKey, 2, contacts.length, context);
  const value = await createShareGeneration({
    vaultId: ids.vault,
    generationId,
    purpose: purpose === "DEATH" ? "death-share" : "recovery-share",
    threshold: 2,
    shares: split.shares,
    commitments: split.commitments,
  });
  const envelopes = await sealShareGeneration({
    generation: value,
    contacts: contacts.map((contact) => ({
      contactId: contact.contactId,
      publicKey: contact.keyPair.publicKey,
    })),
  });
  return Object.freeze({
    generationId,
    context,
    shares: split.shares,
    commitments: split.commitments,
    envelopes,
  });
}

export async function createCryptoUsers(): Promise<CryptoUsers> {
  const material = await createVaultKeyMaterial();
  const contacts: CryptoContact[] = [];
  for (const [index, contactId] of ids.contacts.entries()) {
    if (contactId === undefined) continue;
    const keyPair = await generateContactKeyPair();
    const contactKek = await generateVaultKey();
    const wrappedPrivateKey = await wrapContactPrivateKey({
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      contactKek,
      vaultId: ids.vault,
      contactId,
    });
    contacts.push(
      Object.freeze({
        contactId,
        email: `contact-${index + 1}@example.test`,
        password: `contact-${index + 1}-password-2026`,
        keyPair,
        contactKek,
        wrappedPrivateKey,
      }),
    );
  }
  return Object.freeze({
    owner: Object.freeze({
      email: "owner+e2e@example.test",
      password: "owner-e2e-password-2026",
    }),
    vaultId: ids.vault,
    packageId: ids.package,
    vaultKey: material.vaultKey,
    vkCommitment: material.vkCommitment,
    contacts: Object.freeze(contacts),
    deathGeneration: await generation(
      "DEATH",
      ids.deathGeneration,
      material.vaultKey,
      material.vkCommitment,
      contacts,
    ),
    recoveryGeneration: await generation(
      "RECOVERY",
      ids.recoveryGeneration,
      material.vaultKey,
      material.vkCommitment,
      contacts,
    ),
  });
}
