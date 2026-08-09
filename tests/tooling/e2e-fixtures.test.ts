import { inspectZip } from "@dls/storage";
import { combinePedersen, verifyPedersenShare } from "@dls/vss-wasm";
import { describe, expect, it } from "vitest";
import { composeProjectName, validateMailpitTransport } from "../e2e/fixtures/app.js";
import { SecretLeakDetector } from "../e2e/fixtures/assert-no-secrets.js";
import { createCryptoUsers } from "../e2e/fixtures/crypto-users.js";
import { extractFragmentLink, validateMailpitApiUrl } from "../e2e/fixtures/mailpit.js";
import { createSyntheticLegacy } from "../e2e/fixtures/synthetic-legacy.js";

describe("full-stack E2E fixture boundaries", () => {
  it("creates deterministic valid Compose project names and accepts only Mailpit SMTP", () => {
    expect(composeProjectName("worker 17 / windows")).toBe("dls-e2e-worker-17-windows");
    expect(() => validateMailpitTransport("smtp://mailpit:1025")).not.toThrow();
    expect(() => validateMailpitTransport("smtp://127.0.0.1:1025")).not.toThrow();
    expect(() => validateMailpitTransport("smtps://mail.example.com:465")).toThrow(/Mailpit/u);
  });

  it("builds real contact keys, encrypted private keys, and verifiable VSS share sets", async () => {
    const fixture = await createCryptoUsers();

    expect(fixture.contacts).toHaveLength(3);
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
    const detector = new SecretLeakDetector();
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
    expect(() =>
      extractFragmentLink(
        '<a href="https://evil.example/contact-invitations#token=abc123">Accept</a>',
        "http://127.0.0.1:18081",
      ),
    ).toThrow(/same-origin/u);
  });
});
