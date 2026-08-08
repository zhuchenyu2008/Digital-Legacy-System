function getBase64Encoder(): (value: string) => string {
  const encoder = (globalThis as { btoa?: (value: string) => string }).btoa;
  if (encoder === undefined) throw new Error("The runtime does not provide btoa");
  return encoder;
}

function getBase64Decoder(): (value: string) => string {
  const decoder = (globalThis as { atob?: (value: string) => string }).atob;
  if (decoder === undefined) throw new Error("The runtime does not provide atob");
  return decoder;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return getBase64Encoder()(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function isCanonicalBase64Url(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 === 1) return false;
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return false;
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const standard = value.replaceAll("-", "+").replaceAll("_", "/") + padding;
    const decoded = getBase64Decoder()(standard);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    return encodeBase64Url(bytes) === value;
  } catch {
    return false;
  }
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!isCanonicalBase64Url(value)) throw new Error("Invalid canonical base64url");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const standard = value.replaceAll("-", "+").replaceAll("_", "/") + padding;
  const binary = getBase64Decoder()(standard);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
