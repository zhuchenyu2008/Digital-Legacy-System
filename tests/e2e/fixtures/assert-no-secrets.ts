import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";
import {
  contactKeyId,
  decodeBase64Url,
  deriveBrowserKey,
  openShareV1,
  unwrapContactPrivateKey,
  unwrapKeyV1,
} from "../../../packages/crypto/dist/browser.js";
import type { E2EStackState } from "../stack-state.js";
import type { CryptoUsers } from "./crypto-users.js";
import { MailpitClient } from "./mailpit.js";
import type { SyntheticLegacy } from "./synthetic-legacy.js";

export type SecretSurface =
  | "network-url"
  | "html"
  | "storage"
  | "browser-console"
  | "api-log"
  | "worker-log"
  | "caddy-log"
  | "database-job"
  | "mailpit";

type RegisteredSecret = Readonly<{
  label: string;
  variants: readonly string[];
  allowedOn: ReadonlySet<SecretSurface>;
}>;

function variants(value: string | Uint8Array): readonly string[] {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  const text = typeof value === "string" ? value : "";
  return [
    text,
    bytes.toString("hex"),
    bytes.toString("base64"),
    bytes.toString("base64url"),
  ].filter((entry, index, all) => entry.length >= 8 && all.indexOf(entry) === index);
}

export function networkUrlWithoutFragment(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export class SecretLeakDetector {
  readonly #secrets: RegisteredSecret[] = [];
  readonly #captured: Readonly<{ surface: SecretSurface; text: string }>[] = [];

  public register(
    label: string,
    value: string | Uint8Array,
    policy: Readonly<{ allowedOn?: readonly SecretSurface[] }> = {},
  ): void {
    const encoded = variants(value);
    if (encoded.length === 0) throw new Error(`secret ${label} has no scannable representation`);
    this.#secrets.push(
      Object.freeze({
        label,
        variants: encoded,
        allowedOn: new Set(policy.allowedOn ?? []),
      }),
    );
  }

  public assertText(surface: SecretSurface, text: string): void {
    for (const secret of this.#secrets) {
      if (secret.allowedOn.has(surface)) continue;
      if (secret.variants.some((variant) => text.includes(variant))) {
        throw new Error(`secret leak detected on ${surface}: ${secret.label}`);
      }
    }
  }

  public capture(surface: SecretSurface, text: string): void {
    (this.#captured as { surface: SecretSurface; text: string }[]).push({ surface, text });
  }

  public attach(page: Page): void {
    page.on("console", (message) => this.capture("browser-console", message.text()));
    page.on("request", (request) =>
      this.capture("network-url", networkUrlWithoutFragment(request.url())),
    );
  }

  public async assertPage(page: Page): Promise<void> {
    const snapshot = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      localStorage: JSON.stringify({ ...localStorage }),
      sessionStorage: JSON.stringify({ ...sessionStorage }),
      url: location.href,
    }));
    this.assertText("html", snapshot.html);
    this.assertText("storage", `${snapshot.localStorage}\n${snapshot.sessionStorage}`);
    this.assertText("network-url", snapshot.url);
    for (const captured of this.#captured) this.assertText(captured.surface, captured.text);
  }
}

export type SecretCheckedContext = Readonly<{
  newPage(): Promise<Page>;
  storageState: BrowserContext["storageState"];
  close(): Promise<void>;
}>;

export async function createSecretCheckedContext(
  browser: Browser,
  detector: SecretLeakDetector,
  options?: BrowserContextOptions,
): Promise<SecretCheckedContext> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    ...options,
  });
  const pages = new Set<Page>();
  const track = (page: Page) => {
    if (pages.has(page)) return;
    pages.add(page);
    detector.attach(page);
  };
  context.on("page", track);
  for (const page of context.pages()) track(page);

  let closed = false;
  return {
    newPage: () => context.newPage(),
    storageState: context.storageState.bind(context),
    close: async () => {
      if (closed) return;
      closed = true;
      let failure: unknown;
      for (const page of pages) {
        try {
          if (page.isClosed()) throw new Error("secret-checked page closed before final scan");
          await detector.assertPage(page);
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        await context.close();
      } catch (error) {
        failure ??= error;
      }
      if (failure !== undefined) throw failure;
    },
  };
}

export type LiveOwnerVaultMaterial = Readonly<{
  vaultId: string;
  ownerVaultEnvelope: Readonly<{
    ciphertext: string;
    nonce: string;
    kdfSalt: string;
  }>;
}>;

export async function registerLiveOwnerVaultSecrets(
  detector: SecretLeakDetector,
  input: Readonly<{
    label: string;
    password: string;
    material: LiveOwnerVaultMaterial;
  }>,
): Promise<void> {
  const wrappingKey = await deriveBrowserKey(input.password, {
    version: 1,
    algorithm: "argon2id13",
    opsLimit: 3,
    memLimit: 64 * 1024 * 1024,
    salt: input.material.ownerVaultEnvelope.kdfSalt,
    outputBytes: 32,
  });
  let vaultKey: Uint8Array | undefined;
  try {
    vaultKey = await unwrapKeyV1({
      envelope: {
        version: 1,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "owner-vk",
        keyId: "owner-vk",
        nonce: input.material.ownerVaultEnvelope.nonce,
        ciphertext: input.material.ownerVaultEnvelope.ciphertext,
      },
      wrappingKey,
      aad: {
        protocol: "dls-crypto-v1",
        version: 1,
        purpose: "owner-vk",
        vaultId: input.material.vaultId,
        keyId: "owner-vk",
        algorithm: "xchacha20poly1305-ietf",
      },
    });
    detector.register(`${input.label}-vault-kek`, wrappingKey);
    detector.register(`${input.label}-vault-key`, vaultKey);
  } finally {
    wrappingKey.fill(0);
    vaultKey?.fill(0);
  }
}

export type LiveContactCryptoMaterial = Readonly<{
  vaultId: string;
  contactId: string;
  publicKey: string;
  privateKeyEnvelope: Readonly<{
    ciphertext: string;
    nonce: string;
    kdfSalt: string;
  }>;
}>;

export type LiveContactShare = Readonly<{
  purpose: "death-share" | "recovery-share";
  generationId: string;
  shareIndex: number;
  threshold: number;
  ciphertext: string;
  commitment: string;
}>;

export async function registerLiveContactSecrets(
  detector: SecretLeakDetector,
  input: Readonly<{
    label: string;
    password: string;
    material: LiveContactCryptoMaterial;
    shares?: readonly LiveContactShare[];
  }>,
): Promise<void> {
  const publicKey = decodeBase64Url(input.material.publicKey);
  const contactKek = await deriveBrowserKey(input.password, {
    version: 1,
    algorithm: "argon2id13",
    opsLimit: 3,
    memLimit: 64 * 1024 * 1024,
    salt: input.material.privateKeyEnvelope.kdfSalt,
    outputBytes: 32,
  });
  let privateKey: Uint8Array | undefined;
  try {
    privateKey = await unwrapContactPrivateKey({
      envelope: {
        version: 1,
        algorithm: "xchacha20poly1305-ietf",
        purpose: "contact-private-key",
        keyId: await contactKeyId(publicKey),
        nonce: input.material.privateKeyEnvelope.nonce,
        ciphertext: input.material.privateKeyEnvelope.ciphertext,
      },
      publicKey,
      contactKek,
      vaultId: input.material.vaultId,
      contactId: input.material.contactId,
    });
    detector.register(`${input.label}-kek`, contactKek);
    detector.register(`${input.label}-private-key`, privateKey);
    for (const share of input.shares ?? []) {
      const commitmentDigest = createHash("sha256")
        .update(decodeBase64Url(share.commitment))
        .digest("base64url");
      const plaintext = await openShareV1({
        envelope: {
          version: 1,
          algorithm: "crypto-box-seal",
          purpose: share.purpose,
          vaultId: input.material.vaultId,
          generationId: share.generationId,
          contactId: input.material.contactId,
          shareIndex: share.shareIndex,
          threshold: share.threshold,
          commitmentDigest,
          ciphertext: share.ciphertext,
        },
        keyPair: { publicKey, privateKey },
        expected: {
          vaultId: input.material.vaultId,
          generationId: share.generationId,
          purpose: share.purpose,
          contactId: input.material.contactId,
        },
      });
      try {
        detector.register(`${input.label}-${share.purpose}`, plaintext);
      } finally {
        plaintext.fill(0);
      }
    }
  } finally {
    publicKey.fill(0);
    contactKek.fill(0);
    privateKey?.fill(0);
  }
}

export function registerFixtureSecrets(
  detector: SecretLeakDetector,
  users: CryptoUsers,
  legacy: SyntheticLegacy,
): void {
  detector.register("owner-password", users.owner.password);
  detector.register("owner-recovery-password", users.owner.recoveryPassword);
  detector.register("vault-key", users.vaultKey);
  detector.register("will-body", "Private testament fixture text");
  for (const [index, contact] of users.contacts.entries()) {
    detector.register(`contact-${index + 1}-password`, contact.password);
    detector.register(`contact-${index + 1}-rotated-password`, contact.rotatedPassword);
    detector.register(`contact-${index + 1}-reinvited-password`, contact.reinvitedPassword);
    detector.register(`contact-${index + 1}-private-key`, contact.keyPair.privateKey);
    detector.register(`contact-${index + 1}-kek`, contact.contactKek);
  }
  detector.register("rotation-contact-password", users.rotationContact.password);
  for (const [purpose, generation] of [
    ["death", users.deathGeneration],
    ["recovery", users.recoveryGeneration],
  ] as const) {
    for (const [index, share] of generation.shares.entries()) {
      detector.register(`${purpose}-share-${index + 1}`, share);
    }
  }
  detector.register("plaintext-archive", legacy.archive);
}

async function output(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(executable, [...args], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectOutput);
    child.once("exit", (code) => {
      if (code === 0) resolveOutput(Buffer.concat(stdout).toString("utf8"));
      else rejectOutput(new Error(Buffer.concat(stderr).toString("utf8")));
    });
  });
}

function composeArguments(state: E2EStackState): string[] {
  return [
    "compose",
    ...state.composeFiles.flatMap((file) => ["--file", file]),
    "--project-name",
    state.projectName,
  ];
}

export async function assertNoStackSecrets(
  detector: SecretLeakDetector,
  state: E2EStackState,
): Promise<void> {
  const environment = {
    ...process.env,
    DLS_SECRETS_DIR: `${state.runtimeDirectory}/secrets`,
    DOCKER_CONFIG: `${state.runtimeDirectory}/docker-config`,
  };
  const prefix = composeArguments(state);
  const logs = await output("docker", [...prefix, "logs", "--no-color"], environment);
  detector.assertText("api-log", logs);
  const jobs = await output(
    "docker",
    [
      ...prefix,
      "exec",
      "--no-TTY",
      "postgres",
      "psql",
      "--username",
      "postgres",
      "--dbname",
      "dls",
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT COALESCE(jsonb_agg(data), '[]'::jsonb)::text FROM pgboss.job",
    ],
    environment,
  );
  detector.assertText("database-job", jobs);
  const mailpit = new MailpitClient(state.mailpitUrl);
  for (const message of await mailpit.messages()) {
    detector.assertText("mailpit", JSON.stringify(await mailpit.message(message.ID)));
  }
}
