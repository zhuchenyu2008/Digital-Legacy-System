import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OWNER_ARM_CONFIRMATION_TEXT } from "../../packages/application/dist/setup/arm-owner.js";
import { expect, test } from "./fixtures/app.js";
import {
  createSecretCheckedContext,
  type LiveContactCryptoMaterial,
  registerLiveContactSecrets,
} from "./fixtures/assert-no-secrets.js";
import { extractFragmentLink } from "./fixtures/mailpit.js";
import { contactStateFile, readE2EState } from "./stack-state.js";

test("bootstraps a blank deployment and reaches the share-generation gate", async ({
  app,
  browser,
  cryptoUsers,
  mailpit,
  secrets,
}) => {
  const state = await readE2EState();
  const setupToken = (
    await readFile(resolve(state.runtimeDirectory, "secrets/setup-token"), "utf8")
  ).trim();
  secrets.register("setup-token", setupToken);
  await app.open("/setup");
  await app.page.locator("#setup-token").fill(setupToken);
  await app.page.locator("#owner-name").fill("E2E Owner");
  await app.page.locator("#primary-email").fill(cryptoUsers.owner.email);
  await app.page.locator("#new-password").fill(cryptoUsers.owner.password);
  await app.page.locator("#new-password-confirmation").fill(cryptoUsers.owner.password);
  const setupResponsePromise = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/setup/owner") && response.request().method() === "POST",
  );
  await app.page.locator('form button[type="submit"]').click();
  const setupResponse = await setupResponsePromise;
  expect(setupResponse.status()).toBe(201);
  await expect(app.page).toHaveURL(/\/admin(?:\/|$)/u);

  for (const contact of cryptoUsers.contacts) {
    await app.open("/admin/contacts");
    await app.page.locator(".dls-editor button").first().click();
    await app.page.locator("#invite-name").fill(contact.displayName);
    await app.page.locator("#invite-email").fill(contact.email);
    const invitationResponsePromise = app.page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/owner/contacts/invitations") &&
        response.request().method() === "POST",
    );
    await app.page.locator('.dls-inline-form button[type="submit"]').click();
    const invitationResponse = await invitationResponsePromise;
    expect(invitationResponse.status()).toBe(202);
    await expect(app.page.locator(".dls-toast")).toBeVisible();
  }

  const contactStateDirectory = process.env.DLS_E2E_CONTACT_STATE_DIR;
  expect(contactStateDirectory).toBeTruthy();
  if (contactStateDirectory === undefined) {
    throw new Error("DLS_E2E_CONTACT_STATE_DIR is required");
  }
  await mkdir(contactStateDirectory, { recursive: true });
  await Promise.all(
    cryptoUsers.contacts.map(async (contact, index) => {
      const message = await mailpit.waitFor({ recipient: contact.email, subject: /./u });
      const invitation = extractFragmentLink(message.HTML, state.baseUrl);
      const invitationToken = new URLSearchParams(invitation.hash.slice(1)).get("invite");
      expect(invitationToken).toBeTruthy();
      if (invitationToken === null) throw new Error(`contact ${index + 1} invitation is missing`);
      secrets.register(`contact-${index + 1}-invitation-token`, invitationToken, {
        allowedOn: ["mailpit"],
      });
      const context = await createSecretCheckedContext(browser, secrets);
      try {
        const page = await context.newPage();
        await page.goto(invitation.href, { waitUntil: "networkidle" });
        await page.waitForTimeout(30_500);
        for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
          await checkbox.check();
        }
        await page.locator("#contact-new-password").fill(contact.password);
        await page.locator("#contact-new-password-confirm").fill(contact.password);
        await page.locator('form button[type="submit"]').click();
        await expect(page.locator(".dls-toast")).toBeVisible();
        const material = await page.evaluate(async () => {
          const response = await fetch("/api/contact/crypto-material");
          if (!response.ok) throw new Error(`crypto material failed with ${response.status}`);
          return ((await response.json()) as { data: LiveContactCryptoMaterial }).data;
        });
        await registerLiveContactSecrets(secrets, {
          label: `browser-contact-${index + 1}`,
          password: contact.password,
          material,
        });
        await context.storageState({ path: contactStateFile(index) });
      } finally {
        await context.close();
      }
    }),
  );

  await app.open("/admin/contacts");
  await expect(app.page.locator(".dls-contact-card")).toHaveCount(3);
  await app.page.locator("#share-generation-owner-password").fill(cryptoUsers.owner.password);
  await app.page.getByRole("button", { name: /生成并激活新分片代次/u }).click();

  await expect(
    app.page.locator(".dls-contact-card").filter({ hasText: "ACTIVE" }),
    "all accepted contacts must become active through a real browser-generated share generation",
  ).toHaveCount(3);

  await app.open("/admin/files");
  await app.page.locator("#package-owner-password").fill(cryptoUsers.owner.password);
  const uploadFailures: string[] = [];
  app.page.on("response", async (response) => {
    if (!response.url().includes("/api/owner/packages")) return;
    if (response.status() < 400) return;
    uploadFailures.push(`${response.status()} ${await response.text().catch(() => "")}`);
  });
  await app.page
    .locator("#vault-package")
    .setInputFiles(fileURLToPath(new URL("./fixtures/test.zip", import.meta.url)));
  try {
    await expect(app.page.locator(".dls-toast")).toContainText("已激活", { timeout: 60_000 });
  } catch (error) {
    throw new Error(`${String(error)}\nUpload failures: ${uploadFailures.join(" | ")}`);
  }
  await app.open("/admin/files");
  await expect(app.page.locator(".dls-package-list")).toContainText("当前有效版本");
  await expect(app.page.locator(".dls-package-list")).toContainText("当前有效");

  await app.open("/admin/settings");
  const smtpButton = app.page.locator(".dls-smtp-action button");
  await expect(smtpButton).toBeEnabled();
  const smtpResponsePromise = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/owner/smtp-settings/test") &&
      response.request().method() === "POST",
  );
  await smtpButton.click();
  expect((await smtpResponsePromise).status()).toBe(200);
  await expect(app.page.locator(".dls-toast")).toContainText("SMTP", { timeout: 30_000 });
  await mailpit.waitFor({ recipient: cryptoUsers.owner.email, subject: /SMTP test/u });

  await app.page.locator("#arm-owner-password").fill(cryptoUsers.owner.password);
  await app.page.locator("#arm-owner-confirmation").fill(OWNER_ARM_CONFIRMATION_TEXT);
  const armResponsePromise = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/owner/arm") && response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: /ARMED/u }).click();
  expect((await armResponsePromise).status()).toBe(201);
  await expect(app.page.locator(".dls-toast").filter({ hasText: "ARMED" })).toBeVisible();

  const setupStatus = await app.page.evaluate(async () => {
    const response = await fetch("/api/setup/status");
    return response.json();
  });
  expect(setupStatus.data?.steps).toMatchObject({
    owner: true,
    contacts: true,
    package: true,
    smtpTest: true,
    riskAccepted: true,
  });

  const auditIntegrity = await app.page.evaluate(async () => {
    const response = await fetch("/api/owner/audit-integrity");
    return response.json();
  });
  expect(auditIntegrity.data ?? auditIntegrity).toMatchObject({ valid: true });

  const ownerStateFile = process.env.DLS_E2E_OWNER_STATE_FILE;
  expect(ownerStateFile).toBeTruthy();
  if (ownerStateFile === undefined) throw new Error("DLS_E2E_OWNER_STATE_FILE is required");
  await app.page.context().storageState({ path: ownerStateFile });
  expect((await readFile(ownerStateFile, "utf8")).length).toBeGreaterThan(0);
});
