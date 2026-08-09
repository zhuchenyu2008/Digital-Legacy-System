import { spawn } from "node:child_process";
import type { Page } from "@playwright/test";
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
    page.on("request", (request) => this.capture("network-url", request.url()));
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

export function registerFixtureSecrets(
  detector: SecretLeakDetector,
  users: CryptoUsers,
  legacy: SyntheticLegacy,
): void {
  detector.register("owner-password", users.owner.password);
  detector.register("vault-key", users.vaultKey);
  detector.register("will-body", "Private testament fixture text");
  for (const [index, contact] of users.contacts.entries()) {
    detector.register(`contact-${index + 1}-password`, contact.password);
    detector.register(`contact-${index + 1}-private-key`, contact.keyPair.privateKey);
    detector.register(`contact-${index + 1}-kek`, contact.contactKek);
  }
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
