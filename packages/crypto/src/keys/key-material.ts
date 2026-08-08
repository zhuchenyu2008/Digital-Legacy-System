import sodium from "libsodium-wrappers-sumo";

export const VAULT_KEY_BYTES = 32;
export const HASH_BYTES = 32;

const VK_COMMITMENT_LABEL = "DLS/VK-COMMITMENT/V1\0";
const textEncoder = new TextEncoder();

function ownBytes(value: Uint8Array, name: string, expectedLength?: number): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be a Uint8Array`);
  if (expectedLength !== undefined && value.length !== expectedLength) {
    throw new Error(`${name} must be ${expectedLength} bytes`);
  }
  return new Uint8Array(value);
}

function labelledMessage(label: string, value: Uint8Array): Uint8Array {
  const labelBytes = textEncoder.encode(label);
  const message = new Uint8Array(labelBytes.length + value.length);
  message.set(labelBytes);
  message.set(value, labelBytes.length);
  return message;
}

export async function hashWithLabel(
  label: string,
  value: Uint8Array,
  outputBytes = HASH_BYTES,
): Promise<Uint8Array> {
  const owned = ownBytes(value, "value");
  const message = labelledMessage(label, owned);
  try {
    await sodium.ready;
    return new Uint8Array(sodium.crypto_generichash(outputBytes, message, null));
  } finally {
    owned.fill(0);
    message.fill(0);
  }
}

export async function generateVaultKey(): Promise<Uint8Array> {
  await sodium.ready;
  return new Uint8Array(sodium.randombytes_buf(VAULT_KEY_BYTES));
}

export async function commitVaultKey(vaultKey: Uint8Array): Promise<Uint8Array> {
  const owned = ownBytes(vaultKey, "vaultKey", VAULT_KEY_BYTES);
  try {
    return await hashWithLabel(VK_COMMITMENT_LABEL, owned);
  } finally {
    owned.fill(0);
  }
}

export type VaultKeyMaterial = Readonly<{
  vaultKey: Uint8Array;
  vkCommitment: Uint8Array;
}>;

export async function createVaultKeyMaterial(): Promise<VaultKeyMaterial> {
  const vaultKey = await generateVaultKey();
  try {
    const vkCommitment = await commitVaultKey(vaultKey);
    return Object.freeze({ vaultKey, vkCommitment });
  } catch (error) {
    vaultKey.fill(0);
    throw error;
  }
}

export function assertKeyBytes(value: Uint8Array, name: string): Uint8Array {
  return ownBytes(value, name, VAULT_KEY_BYTES);
}
