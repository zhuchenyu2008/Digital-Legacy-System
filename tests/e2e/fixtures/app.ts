import { test as base, expect, type Page } from "@playwright/test";
import { readE2EState } from "../stack-state.js";
import {
  assertNoStackSecrets,
  registerFixtureSecrets,
  SecretLeakDetector,
} from "./assert-no-secrets.js";
import { type CryptoUsers, createCryptoUsers } from "./crypto-users.js";
import { MailpitClient } from "./mailpit.js";
import { createSyntheticLegacy, type SyntheticLegacy } from "./synthetic-legacy.js";

export function composeProjectName(seed: string): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 42);
  if (normalized.length === 0)
    throw new Error("Compose project seed must contain a letter or digit");
  return `dls-e2e-${normalized}`;
}

export function validateMailpitTransport(value: string): URL {
  const transport = new URL(value);
  if (
    transport.protocol !== "smtp:" ||
    !["mailpit", "127.0.0.1", "localhost"].includes(transport.hostname) ||
    transport.port !== "1025"
  ) {
    throw new Error("E2E SMTP transport must use Mailpit on port 1025");
  }
  return transport;
}

export class DlsApp {
  public constructor(public readonly page: Page) {}

  public async open(path: string): Promise<void> {
    await this.page.goto(path, { waitUntil: "networkidle" });
    await expect(this.page.locator("main")).toBeVisible();
  }

  public async setupOwner(input: Readonly<{ email: string; password: string }>): Promise<void> {
    await this.open("/setup");
    await this.page.locator('input[type="email"]').fill(input.email);
    const passwords = this.page.locator('input[type="password"]');
    await passwords.first().fill(input.password);
    if ((await passwords.count()) > 1) await passwords.nth(1).fill(input.password);
    await this.page.getByRole("button", { name: /创建|初始化|完成/u }).click();
  }

  public async loginOwner(password: string): Promise<void> {
    await this.open("/login");
    await this.page.locator('input[type="password"]').fill(password);
    await this.page.getByRole("button", { name: /登录|签到/u }).click();
    await expect(this.page).toHaveURL(/\/admin(?:\/|$)/u);
  }

  public async acceptContactInvitation(input: Readonly<{ url: string; password: string }>) {
    await this.page.goto(input.url, { waitUntil: "networkidle" });
    const passwords = this.page.locator('input[type="password"]');
    await passwords.first().fill(input.password);
    if ((await passwords.count()) > 1) await passwords.nth(1).fill(input.password);
    await this.page.getByRole("button", { name: /接受|确认/u }).click();
  }
}

type DlsFixtures = Readonly<{
  app: DlsApp;
  cryptoUsers: CryptoUsers;
  legacy: SyntheticLegacy;
  mailpit: MailpitClient;
  secrets: SecretLeakDetector;
}>;

export const test = base.extend<DlsFixtures>({
  app: async ({ page }, use) => {
    await use(new DlsApp(page));
  },
  cryptoUsers: async ({ page: _page }, use) => {
    await use(await createCryptoUsers());
  },
  legacy: async ({ cryptoUsers }, use) => {
    await use(await createSyntheticLegacy(cryptoUsers.vaultKey));
  },
  mailpit: async ({ page: _page }, use) => {
    const state = await readE2EState();
    await use(new MailpitClient(state.mailpitUrl));
  },
  secrets: [
    async ({ cryptoUsers, legacy, page }, use) => {
      const detector = new SecretLeakDetector();
      registerFixtureSecrets(detector, cryptoUsers, legacy);
      detector.attach(page);
      await use(detector);
      await detector.assertPage(page);
      await assertNoStackSecrets(detector, await readE2EState());
    },
    { auto: true },
  ],
});

export { expect };
