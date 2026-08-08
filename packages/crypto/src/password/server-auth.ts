import { randomBytes } from "node:crypto";
import argon2, { argon2id } from "argon2";

import { normalizePassword } from "./normalize-password.js";

export type ServerAuthProfile = Readonly<{
  timeCost: number;
  memoryCostKiB: number;
  parallelism: number;
  hashLength: 32;
  saltBytes: number;
}>;

const DEFAULT_SERVER_AUTH_PROFILE: ServerAuthProfile = {
  timeCost: 3,
  memoryCostKiB: 64 * 1024,
  parallelism: 1,
  hashLength: 32,
  saltBytes: 16,
};

function validateProfile(profile: ServerAuthProfile): void {
  if (
    !Number.isSafeInteger(profile.timeCost) ||
    profile.timeCost < 1 ||
    !Number.isSafeInteger(profile.memoryCostKiB) ||
    profile.memoryCostKiB < 8 * 1024 ||
    !Number.isSafeInteger(profile.parallelism) ||
    profile.parallelism < 1 ||
    profile.hashLength !== 32 ||
    !Number.isSafeInteger(profile.saltBytes) ||
    profile.saltBytes < 16
  ) {
    throw new RangeError("Invalid server Argon2id profile");
  }
}

function passwordMaterial(password: string, pepper: Uint8Array): Buffer {
  if (!(pepper instanceof Uint8Array) || pepper.length < 16) {
    throw new RangeError("Deployment pepper must contain at least 16 bytes");
  }
  const normalized = normalizePassword(password);
  const material = Buffer.allocUnsafe(normalized.length + pepper.length);
  material.set(normalized, 0);
  material.set(pepper, normalized.length);
  normalized.fill(0);
  return material;
}

export async function hashServerPassword(
  password: string,
  pepper: Uint8Array,
  profile: ServerAuthProfile = DEFAULT_SERVER_AUTH_PROFILE,
): Promise<string> {
  validateProfile(profile);
  const material = passwordMaterial(password, pepper);
  try {
    return await argon2.hash(material, {
      type: argon2id,
      timeCost: profile.timeCost,
      memoryCost: profile.memoryCostKiB,
      parallelism: profile.parallelism,
      hashLength: profile.hashLength,
      salt: randomBytes(profile.saltBytes),
    });
  } finally {
    material.fill(0);
  }
}

export async function verifyServerPassword(
  password: string,
  pepper: Uint8Array,
  encodedHash: string,
): Promise<boolean> {
  if (typeof encodedHash !== "string" || !encodedHash.startsWith("$argon2id$")) return false;
  const material = passwordMaterial(password, pepper);
  try {
    return await argon2.verify(encodedHash, material);
  } catch {
    return false;
  } finally {
    material.fill(0);
  }
}
