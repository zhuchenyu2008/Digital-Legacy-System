import type { TransactionManager } from "../ports/transaction-manager.js";
import { ContactUseCaseError } from "./contact-common.js";

export async function getContactCryptoMaterial(contactId: string, transaction: TransactionManager) {
  return transaction.run(async (tx) => {
    const contact = await tx.repositories.contacts.findById(contactId);
    if (
      contact === null ||
      contact.status === "REMOVED" ||
      !(contact.x25519_public_key instanceof Uint8Array) ||
      !(contact.private_key_ciphertext instanceof Uint8Array) ||
      !(contact.private_key_nonce instanceof Uint8Array) ||
      !(contact.private_key_kdf_salt instanceof Uint8Array)
    ) {
      throw new ContactUseCaseError(
        "CONTACT_NOT_FOUND",
        "contact crypto material is unavailable",
        404,
      );
    }
    const vaults = (await tx.repositories.vaults.findMany?.()) ?? [];
    if (vaults.length !== 1) {
      throw new ContactUseCaseError(
        "CONTACT_KEY_INVALID",
        "contact vault context is unavailable",
        409,
      );
    }
    return {
      contactId,
      vaultId: String(vaults[0]?.id),
      publicKey: Buffer.from(contact.x25519_public_key).toString("base64url"),
      privateKeyEnvelope: {
        ciphertext: Buffer.from(contact.private_key_ciphertext).toString("base64url"),
        nonce: Buffer.from(contact.private_key_nonce).toString("base64url"),
        kdfSalt: Buffer.from(contact.private_key_kdf_salt).toString("base64url"),
        kdfParams: contact.private_key_kdf_params,
      },
    };
  });
}
