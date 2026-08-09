import { assertX25519KeyPair } from "@dls/crypto/node";

export type WorkerKeyCapabilities = Readonly<{
  releaseIngress: Readonly<{
    version: number;
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }>;
  releaseStage: Readonly<{ version: number; key: Uint8Array }>;
}>;

const FORBIDDEN = [
  "RECOVERY_INGRESS_PUBLIC_KEY",
  "RECOVERY_INGRESS_PRIVATE_KEY",
  "RECOVERY_STAGE_KEK",
] as const;

function required(environment: Record<string, string | undefined>, variable: string): string {
  const value = environment[variable];
  if (!value) throw new Error(`Invalid worker key capabilities: ${variable} is required`);
  return value;
}

function version(environment: Record<string, string | undefined>, variable: string): number {
  const value = Number(required(environment, variable));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid worker key capabilities: ${variable} must be a positive integer`);
  }
  return value;
}

function key(environment: Record<string, string | undefined>, variable: string): Uint8Array {
  const encoded = required(environment, variable);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error(`Invalid worker key capabilities: ${variable} must be canonical base64`);
  }
  const decoded = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (decoded.length !== 32 || Buffer.from(decoded).toString("base64") !== encoded) {
    decoded.fill(0);
    throw new Error(`Invalid worker key capabilities: ${variable} must decode to 32 bytes`);
  }
  return decoded;
}

export async function loadWorkerKeyCapabilities(
  environment: Record<string, string | undefined> = process.env,
): Promise<WorkerKeyCapabilities> {
  for (const variable of FORBIDDEN) {
    if (environment[variable] !== undefined) {
      throw new Error(`Invalid worker key capabilities: forbidden secret mount ${variable}`);
    }
  }

  let releasePublicKey: Uint8Array | undefined;
  let releasePrivateKey: Uint8Array | undefined;
  let releaseStageKey: Uint8Array | undefined;
  try {
    releasePublicKey = key(environment, "RELEASE_INGRESS_PUBLIC_KEY");
    releasePrivateKey = key(environment, "RELEASE_INGRESS_PRIVATE_KEY");
    releaseStageKey = key(environment, "RELEASE_STAGE_KEK");
    await assertX25519KeyPair({
      publicKey: releasePublicKey,
      privateKey: releasePrivateKey,
    });
    return Object.freeze({
      releaseIngress: Object.freeze({
        version: version(environment, "RELEASE_INGRESS_KEY_VERSION"),
        publicKey: releasePublicKey,
        privateKey: releasePrivateKey,
      }),
      releaseStage: Object.freeze({
        version: version(environment, "RELEASE_STAGE_KEY_VERSION"),
        key: releaseStageKey,
      }),
    });
  } catch (error) {
    releasePublicKey?.fill(0);
    releasePrivateKey?.fill(0);
    releaseStageKey?.fill(0);
    throw error;
  }
}
