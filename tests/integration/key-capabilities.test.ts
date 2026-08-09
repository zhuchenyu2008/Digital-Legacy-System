import { generateContactKeyPair } from "@dls/crypto/node";
import { describe, expect, it } from "vitest";
import { loadApiKeyCapabilities } from "../../apps/api/src/config/key-capabilities.js";
import { loadWorkerKeyCapabilities } from "../../apps/worker/src/config/key-capabilities.js";

const encode = (value: Uint8Array) => Buffer.from(value).toString("base64");
const stageKey = (seed: number) =>
  Uint8Array.from({ length: 32 }, (_, index) => (seed + index) & 0xff);

async function environments() {
  const release = await generateContactKeyPair();
  const recovery = await generateContactKeyPair();
  const api = {
    RELEASE_INGRESS_PUBLIC_KEY: encode(release.publicKey),
    RELEASE_INGRESS_KEY_VERSION: "3",
    RECOVERY_INGRESS_PUBLIC_KEY: encode(recovery.publicKey),
    RECOVERY_INGRESS_PRIVATE_KEY: encode(recovery.privateKey),
    RECOVERY_INGRESS_KEY_VERSION: "5",
    RECOVERY_STAGE_KEK: encode(stageKey(51)),
    RECOVERY_STAGE_KEY_VERSION: "7",
  };
  const worker = {
    RELEASE_INGRESS_PUBLIC_KEY: encode(release.publicKey),
    RELEASE_INGRESS_PRIVATE_KEY: encode(release.privateKey),
    RELEASE_INGRESS_KEY_VERSION: "3",
    RELEASE_STAGE_KEK: encode(stageKey(91)),
    RELEASE_STAGE_KEY_VERSION: "11",
  };
  return { api, worker, release, recovery };
}

describe("purpose-separated process key capabilities", () => {
  it("boots API with release-public plus recovery-private/stage capabilities only", async () => {
    const { api } = await environments();
    const capabilities = await loadApiKeyCapabilities(api);

    expect(capabilities.releaseIngress).toMatchObject({ version: 3 });
    expect(capabilities.releaseIngress.publicKey).toHaveLength(32);
    expect(capabilities.releaseIngress).not.toHaveProperty("privateKey");
    expect(capabilities).not.toHaveProperty("releaseStage");
    expect(capabilities.recoveryIngress).toMatchObject({ version: 5 });
    expect(capabilities.recoveryIngress.privateKey).toHaveLength(32);
    expect(capabilities.recoveryStage).toMatchObject({ version: 7 });
    expect(capabilities.recoveryStage.key).toHaveLength(32);
  });

  it("boots worker with release-private/stage capabilities and no recovery keys", async () => {
    const { worker } = await environments();
    const capabilities = await loadWorkerKeyCapabilities(worker);

    expect(capabilities.releaseIngress).toMatchObject({ version: 3 });
    expect(capabilities.releaseIngress.publicKey).toHaveLength(32);
    expect(capabilities.releaseIngress.privateKey).toHaveLength(32);
    expect(capabilities.releaseStage).toMatchObject({ version: 11 });
    expect(capabilities).not.toHaveProperty("recoveryIngress");
    expect(capabilities).not.toHaveProperty("recoveryStage");
  });

  it("refuses forbidden cross-process secret mounts", async () => {
    const { api, worker, release, recovery } = await environments();

    await expect(
      loadApiKeyCapabilities({
        ...api,
        RELEASE_INGRESS_PRIVATE_KEY: encode(release.privateKey),
      }),
    ).rejects.toThrow(/forbidden.*RELEASE_INGRESS_PRIVATE_KEY/i);
    await expect(
      loadApiKeyCapabilities({ ...api, RELEASE_STAGE_KEK: encode(stageKey(91)) }),
    ).rejects.toThrow(/forbidden.*RELEASE_STAGE_KEK/i);
    await expect(
      loadWorkerKeyCapabilities({
        ...worker,
        RECOVERY_INGRESS_PUBLIC_KEY: encode(recovery.publicKey),
      }),
    ).rejects.toThrow(/forbidden.*RECOVERY_INGRESS_PUBLIC_KEY/i);
    await expect(
      loadWorkerKeyCapabilities({ ...worker, RECOVERY_STAGE_KEK: encode(stageKey(51)) }),
    ).rejects.toThrow(/forbidden.*RECOVERY_STAGE_KEK/i);
  });

  it("refuses missing, malformed, mismatched, or unversioned key material", async () => {
    const { api, worker, release } = await environments();

    await expect(
      loadApiKeyCapabilities({ ...api, RECOVERY_INGRESS_PRIVATE_KEY: undefined }),
    ).rejects.toThrow(/RECOVERY_INGRESS_PRIVATE_KEY/);
    await expect(
      loadWorkerKeyCapabilities({ ...worker, RELEASE_STAGE_KEK: "not-base64" }),
    ).rejects.toThrow(/RELEASE_STAGE_KEK/);
    await expect(
      loadWorkerKeyCapabilities({ ...worker, RELEASE_INGRESS_KEY_VERSION: "0" }),
    ).rejects.toThrow(/RELEASE_INGRESS_KEY_VERSION/);
    await expect(
      loadWorkerKeyCapabilities({
        ...worker,
        RELEASE_INGRESS_PRIVATE_KEY: encode((await generateContactKeyPair()).privateKey),
        RELEASE_INGRESS_PUBLIC_KEY: encode(release.publicKey),
      }),
    ).rejects.toThrow(/does not match/i);
  });
});
