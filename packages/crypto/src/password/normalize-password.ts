export function normalizePassword(password: string): Uint8Array {
  if (typeof password !== "string") throw new TypeError("Password must be a string");
  for (let index = 0; index < password.length; index += 1) {
    const code = password.charCodeAt(index);
    if (code === 0) throw new Error("Password must not contain NUL");
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = password.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff)
        throw new Error("Password contains an unpaired surrogate");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("Password contains an unpaired surrogate");
    }
  }
  const normalized = password.normalize("NFC");
  const bytes = new TextEncoder().encode(normalized);
  if (bytes.length > 512) throw new Error("Password must be at most 512 UTF-8 bytes");
  return bytes;
}
