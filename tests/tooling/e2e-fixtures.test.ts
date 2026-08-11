import { readFile } from "node:fs/promises";
import { inspectZip } from "@dls/storage";
import { combinePedersen, verifyPedersenShare } from "@dls/vss-wasm";
import { describe, expect, it } from "vitest";
import {
  deriveBrowserKey,
  encodeBase64Url,
  generateContactKeyPair,
  generateVaultKey,
  sealShareV1,
  wrapContactPrivateKey,
  wrapKeyV1,
} from "../../packages/crypto/dist/browser.js";
import {
  assertDisposableComposeProjectName,
  composeProjectName,
  validateMailpitTransport,
} from "../e2e/fixtures/app.js";
import * as secretLeakFixture from "../e2e/fixtures/assert-no-secrets.js";
import { createCryptoUsers } from "../e2e/fixtures/crypto-users.js";
import { extractFragmentLink, validateMailpitApiUrl } from "../e2e/fixtures/mailpit.js";
import { selectSimulationContactIds } from "../e2e/fixtures/simulation.js";
import { createSyntheticLegacy } from "../e2e/fixtures/synthetic-legacy.js";
import { assertE2ERuntimeDirectory, contactStateFile } from "../e2e/stack-state.js";

describe("full-stack E2E fixture boundaries", () => {
  it("creates deterministic valid Compose project names and accepts only Mailpit SMTP", () => {
    expect(composeProjectName("worker 17 / windows")).toBe("dls-e2e-worker-17-windows");
    expect(assertDisposableComposeProjectName("dls-e2e-run-17")).toBe("dls-e2e-run-17");
    expect(() => assertDisposableComposeProjectName("dls-local-v1")).toThrow(/disposable/u);
    expect(() => assertDisposableComposeProjectName("dls-e2e-../production")).toThrow(
      /disposable/u,
    );
    expect(
      assertE2ERuntimeDirectory("dls-e2e-run-17", ".e2e-runtime/dls-e2e-run-17").replaceAll(
        "\\",
        "/",
      ),
    ).toMatch(/\.e2e-runtime\/dls-e2e-run-17$/u);
    expect(() => assertE2ERuntimeDirectory("dls-e2e-run-17", "D:/")).toThrow(/runtime/u);
    expect(() => validateMailpitTransport("smtp://mailpit:1025")).not.toThrow();
    expect(() => validateMailpitTransport("smtp://127.0.0.1:1025")).not.toThrow();
    expect(() => validateMailpitTransport("smtps://mail.example.com:465")).toThrow(/Mailpit/u);
  });

  it("builds real contact keys, encrypted private keys, and verifiable VSS share sets", async () => {
    const fixture = await createCryptoUsers();

    expect(fixture.contacts).toHaveLength(3);
    expect(fixture.rotationContact.email).toBe("contact-4@example.test");
    for (const contact of fixture.contacts) {
      expect(contact.keyPair.publicKey).toHaveLength(32);
      expect(contact.keyPair.privateKey).toHaveLength(32);
      expect(contact.wrappedPrivateKey.ciphertext.length).toBeGreaterThan(32);
    }
    for (const generation of [fixture.deathGeneration, fixture.recoveryGeneration]) {
      expect(generation.shares).toHaveLength(3);
      for (const share of generation.shares) {
        expect(verifyPedersenShare(share, generation.commitments, generation.context)).toBe(true);
      }
      expect(
        combinePedersen(generation.shares.slice(0, 2), generation.commitments, generation.context),
      ).toEqual(fixture.vaultKey);
      expect(generation.envelopes).toHaveLength(3);
    }
  });

  it("creates a deterministic root-will ZIP and encrypts it with production secretstream", async () => {
    const users = await createCryptoUsers();
    const legacy = await createSyntheticLegacy(users.vaultKey);
    const inspected = await inspectZip(legacy.archive);

    expect(inspected.entries.map((entry) => entry.path)).toEqual([
      "will.md",
      "attachments/proof.bin",
    ]);
    expect(legacy.archiveSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(legacy.encrypted.manifest.algorithm).toBe("secretstream-xchacha20poly1305");
    expect(legacy.encrypted.manifest.plaintextBytes).toBe(legacy.archive.length);
    expect(legacy.encrypted.ciphertext).not.toEqual(legacy.archive);
  });

  it("detects registered secrets on forbidden surfaces and honors explicit surface policy", () => {
    const detector = new secretLeakFixture.SecretLeakDetector();
    detector.register("owner-password", "correct-horse-battery-staple");
    detector.register("fragment-token", "fragment-token-123456", { allowedOn: ["mailpit"] });
    detector.register("will-body", "Private testament fixture text");

    expect(() =>
      detector.assertText("network-url", "https://dls.test/login#fragment-token-123456"),
    ).toThrow(/fragment-token/u);
    expect(() => detector.assertText("api-log", "correct-horse-battery-staple")).toThrow(
      /owner-password/u,
    );
    expect(() => detector.assertText("html", "Private testament fixture text")).toThrow(
      /will-body/u,
    );
    expect(() => detector.assertText("mailpit", "fragment-token-123456")).not.toThrow();
    expect(() => detector.assertText("api-log", "sha256:9f86d081884c7d65")).not.toThrow();
    expect(
      secretLeakFixture.networkUrlWithoutFragment(
        "https://dls.test/password-recovery#recovery=fragment-token-123456",
      ),
    ).toBe("https://dls.test/password-recovery");
  });

  it("registers the actual browser owner vault key recovered from its production envelope", async () => {
    type RegisterOwner = (
      detector: secretLeakFixture.SecretLeakDetector,
      input: Readonly<{
        label: string;
        password: string;
        material: Readonly<{
          vaultId: string;
          ownerVaultEnvelope: Readonly<{
            ciphertext: string;
            nonce: string;
            kdfSalt: string;
          }>;
        }>;
      }>,
    ) => Promise<void>;
    const register = (
      secretLeakFixture as unknown as { registerLiveOwnerVaultSecrets?: RegisterOwner }
    ).registerLiveOwnerVaultSecrets;
    expect(register).toBeTypeOf("function");
    if (register === undefined) throw new Error("registerLiveOwnerVaultSecrets is unavailable");

    const detector = new secretLeakFixture.SecretLeakDetector();
    const vaultId = "00000000-0000-4000-8000-00000000f001";
    const password = "live-owner-password-2026";
    const salt = new Uint8Array(16).fill(17);
    const vaultKey = await generateVaultKey();
    const wrappingKey = await deriveBrowserKey(password, {
      version: 1,
      algorithm: "argon2id13",
      opsLimit: 3,
      memLimit: 64 * 1024 * 1024,
      salt: encodeBase64Url(salt),
      outputBytes: 32,
    });
    const envelope = await wrapKeyV1({
      key: vaultKey,
      wrappingKey,
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "owner-vk",
        vaultId,
        keyId: "owner-vk",
        algorithm: "xchacha20poly1305-ietf",
      },
    });

    await register(detector, {
      label: "live-owner",
      password,
      material: {
        vaultId,
        ownerVaultEnvelope: {
          ciphertext: envelope.ciphertext,
          nonce: envelope.nonce,
          kdfSalt: encodeBase64Url(salt),
        },
      },
    });

    expect(() => detector.assertText("api-log", encodeBase64Url(vaultKey))).toThrow(
      /live-owner-vault-key/u,
    );
    expect(() => detector.assertText("worker-log", encodeBase64Url(wrappingKey))).toThrow(
      /live-owner-vault-kek/u,
    );
    vaultKey.fill(0);
    wrappingKey.fill(0);
    salt.fill(0);
  });

  it("registers actual contact private keys, KEKs, and opened browser shares", async () => {
    type RegisterContact = (
      detector: secretLeakFixture.SecretLeakDetector,
      input: Readonly<{
        label: string;
        password: string;
        material: Readonly<{
          vaultId: string;
          contactId: string;
          publicKey: string;
          privateKeyEnvelope: Readonly<{
            ciphertext: string;
            nonce: string;
            kdfSalt: string;
          }>;
        }>;
        shares: readonly Readonly<{
          purpose: "death-share" | "recovery-share";
          generationId: string;
          shareIndex: number;
          threshold: number;
          ciphertext: string;
          commitment: string;
        }>[];
      }>,
    ) => Promise<void>;
    const register = (
      secretLeakFixture as unknown as { registerLiveContactSecrets?: RegisterContact }
    ).registerLiveContactSecrets;
    expect(register).toBeTypeOf("function");
    if (register === undefined) throw new Error("registerLiveContactSecrets is unavailable");

    const detector = new secretLeakFixture.SecretLeakDetector();
    const vaultId = "00000000-0000-4000-8000-00000000f001";
    const contactId = "00000000-0000-4000-8000-00000000f011";
    const generationId = "00000000-0000-4000-8000-00000000f021";
    const password = "live-contact-password-2026";
    const salt = new Uint8Array(16).fill(23);
    const pair = await generateContactKeyPair();
    const contactKek = await deriveBrowserKey(password, {
      version: 1,
      algorithm: "argon2id13",
      opsLimit: 3,
      memLimit: 64 * 1024 * 1024,
      salt: encodeBase64Url(salt),
      outputBytes: 32,
    });
    const privateKeyEnvelope = await wrapContactPrivateKey({
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      contactKek,
      vaultId,
      contactId,
    });
    const share = new Uint8Array(33).fill(41);
    const commitmentBytes = new Uint8Array(32).fill(43);
    const commitment = encodeBase64Url(commitmentBytes);
    const commitmentDigest = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", commitmentBytes)),
    );
    const shareEnvelope = await sealShareV1({
      purpose: "recovery-share",
      vaultId,
      generationId,
      contactId,
      shareIndex: 1,
      threshold: 2,
      commitmentDigest,
      share,
      contactPublicKey: pair.publicKey,
    });

    await register(detector, {
      label: "live-contact",
      password,
      material: {
        vaultId,
        contactId,
        publicKey: encodeBase64Url(pair.publicKey),
        privateKeyEnvelope: {
          ciphertext: privateKeyEnvelope.ciphertext,
          nonce: privateKeyEnvelope.nonce,
          kdfSalt: encodeBase64Url(salt),
        },
      },
      shares: [
        {
          purpose: "recovery-share",
          generationId,
          shareIndex: 1,
          threshold: 2,
          ciphertext: shareEnvelope.ciphertext,
          commitment,
        },
      ],
    });

    expect(() => detector.assertText("api-log", encodeBase64Url(pair.privateKey))).toThrow(
      /live-contact-private-key/u,
    );
    expect(() => detector.assertText("worker-log", encodeBase64Url(contactKek))).toThrow(
      /live-contact-kek/u,
    );
    expect(() => detector.assertText("database-job", encodeBase64Url(share))).toThrow(
      /live-contact-recovery-share/u,
    );
    pair.publicKey.fill(0);
    pair.privateKey.fill(0);
    contactKek.fill(0);
    share.fill(0);
    salt.fill(0);
  });

  it("scans auxiliary browser pages before their context closes", async () => {
    type SecretCheckedContextFactory = (
      browser: unknown,
      detector: secretLeakFixture.SecretLeakDetector,
    ) => Promise<Readonly<{ newPage(): Promise<unknown>; close(): Promise<void> }>>;
    const factory = (
      secretLeakFixture as unknown as {
        createSecretCheckedContext?: SecretCheckedContextFactory;
      }
    ).createSecretCheckedContext;
    expect(factory).toBeTypeOf("function");
    if (factory === undefined) throw new Error("createSecretCheckedContext is unavailable");

    const detector = new secretLeakFixture.SecretLeakDetector();
    detector.register("auxiliary-page-secret", "auxiliary-secret-123456");
    const page = {
      evaluate: async () => ({
        html: "<main>auxiliary-secret-123456</main>",
        localStorage: "{}",
        sessionStorage: "{}",
        url: "https://dls.test/contact",
      }),
      isClosed: () => false,
      on: () => page,
    };
    let onPage: ((value: typeof page) => void) | undefined;
    let contextClosed = false;
    let contextOptions: unknown;
    const context = {
      close: async () => {
        contextClosed = true;
      },
      newPage: async () => {
        onPage?.(page);
        return page;
      },
      on: (event: string, listener: (value: typeof page) => void) => {
        if (event === "page") onPage = listener;
        return context;
      },
      pages: () => [],
      storageState: async () => ({ cookies: [], origins: [] }),
    };
    const checked = await factory(
      {
        newContext: async (options: unknown) => {
          contextOptions = options;
          return context;
        },
      },
      detector,
    );
    await checked.newPage();
    await expect(checked.close()).rejects.toThrow(/auxiliary-page-secret/u);
    expect(contextClosed).toBe(true);
    expect(contextOptions).toEqual({ storageState: { cookies: [], origins: [] } });
  });

  it("routes every full-stack auxiliary context through the secret checker", async () => {
    for (const file of [
      "01-bootstrap-arm.spec.ts",
      "02-checkin-alive-cancel.spec.ts",
      "03-release-owner-cancel.spec.ts",
      "04-release-publish.spec.ts",
      "05-owner-password-recovery.spec.ts",
      "06-contact-rotation-reshare.spec.ts",
      "07-upload-restart-resume.spec.ts",
      "08-role-and-error-boundaries.spec.ts",
      "09-browser-smoke.spec.ts",
    ]) {
      const text = await readFile(new URL(`../e2e/${file}`, import.meta.url), "utf8");
      expect(text, file).not.toContain("browser.newContext(");
      if (text.includes("newContext")) {
        expect(text, file).toContain("createSecretCheckedContext");
      }
    }
  });

  it("extracts same-origin fragment links from Mailpit and rejects external message APIs", () => {
    expect(validateMailpitApiUrl("http://127.0.0.1:8025").href).toBe("http://127.0.0.1:8025/");
    expect(() => validateMailpitApiUrl("https://mail.example.com")).toThrow(/loopback/u);
    expect(
      extractFragmentLink(
        '<a href="http://127.0.0.1:18081/contact-invitations#token=abc123">Accept</a>',
        "http://127.0.0.1:18081",
      ).href,
    ).toBe("http://127.0.0.1:18081/contact-invitations#token=abc123");
    expect(
      extractFragmentLink(
        '<a href="http://127.0.0.1:18081/contact-invitations#invite&#x3D;abc123">Accept</a>',
        "http://127.0.0.1:18081",
      ).href,
    ).toBe("http://127.0.0.1:18081/contact-invitations#invite=abc123");
    expect(() =>
      extractFragmentLink(
        '<a href="https://evil.example/contact-invitations#token=abc123">Accept</a>',
        "http://127.0.0.1:18081",
      ),
    ).toThrow(/same-origin/u);
  });

  it("allocates isolated storage-state files for each accepted contact", () => {
    expect(contactStateFile(0, { DLS_E2E_CONTACT_STATE_DIR: "D:/tmp/dls-e2e/contacts" })).toBe(
      "D:/tmp/dls-e2e/contacts/contact-1.json",
    );
    expect(contactStateFile(2, { DLS_E2E_CONTACT_STATE_DIR: "D:/tmp/dls-e2e/contacts" })).toBe(
      "D:/tmp/dls-e2e/contacts/contact-3.json",
    );
    expect(() =>
      contactStateFile(-1, { DLS_E2E_CONTACT_STATE_DIR: "D:/tmp/dls-e2e/contacts" }),
    ).toThrow(/index/u);
  });

  it("selects the authenticated contact identities by their stable e-mail addresses", () => {
    expect(
      selectSimulationContactIds(
        [
          { id: "contact-2-id", email: "CONTACT-2@example.test" },
          { id: "contact-1-id", email: "contact-1@example.test" },
          { id: "removed-id", email: "removed@example.test" },
        ],
        ["contact-1@example.test", "contact-2@example.test"],
      ),
    ).toEqual(["contact-1-id", "contact-2-id"]);
  });

  it("uses the isolated generated setup secret instead of a repository-known token", async () => {
    const [bootstrap, overlay] = await Promise.all([
      readFile(new URL("../e2e/01-bootstrap-arm.spec.ts", import.meta.url), "utf8"),
      readFile(new URL("../e2e/compose.e2e.yaml", import.meta.url), "utf8"),
    ]);
    expect(bootstrap).not.toContain("local-setup-token");
    expect(bootstrap).toContain('secrets.register("setup-token"');
    expect(bootstrap).toContain('"secrets/setup-token"');
    expect(overlay).toContain("/run/secrets/setup_token");
    expect(overlay).toContain("/run/secrets/session_pepper");
  });
});
