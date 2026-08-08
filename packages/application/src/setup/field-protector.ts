export type ProtectedField = Readonly<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  keyVersion: number;
  lookupHmac: Uint8Array;
}>;

export interface FieldProtector {
  protect(value: string, purpose: string): Promise<ProtectedField>;
}
