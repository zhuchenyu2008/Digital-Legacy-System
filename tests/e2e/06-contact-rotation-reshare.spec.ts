import type { Browser, Page } from "@playwright/test";
import type { DlsApp } from "./fixtures/app.js";
import { expect, test } from "./fixtures/app.js";
import {
  createSecretCheckedContext,
  type LiveContactCryptoMaterial,
  type LiveContactShare,
  registerLiveContactSecrets,
  type SecretLeakDetector,
} from "./fixtures/assert-no-secrets.js";
import { queryPostgres } from "./fixtures/compose.js";
import { extractFragmentLink } from "./fixtures/mailpit.js";
import { contactStateFile, type E2EStackState, readE2EState } from "./stack-state.js";

type ContactInput = Readonly<{ displayName: string; email: string; password: string }>;
type CryptoMaterial = LiveContactCryptoMaterial & Readonly<{ keyId: string }>;

async function invite(app: DlsApp, contact: ContactInput): Promise<void> {
  await app.open("/admin/contacts");
  await app.page.getByRole("button", { name: "邀请新联系人" }).click();
  await app.page.locator("#invite-name").fill(contact.displayName);
  await app.page.locator("#invite-email").fill(contact.email);
  const responsePromise = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/owner/contacts/invitations") &&
      response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "发送邀请" }).click();
  expect((await responsePromise).status()).toBe(202);
}

async function acceptInvitation(
  browser: Browser,
  secrets: SecretLeakDetector,
  invitationUrl: string,
  contact: ContactInput,
  storageStatePath: string,
): Promise<void> {
  const context = await createSecretCheckedContext(browser, secrets);
  try {
    const page = await context.newPage();
    await page.goto(invitationUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(30_500);
    for (const checkbox of await page.locator('input[type="checkbox"]').all()) {
      await checkbox.check();
    }
    await page.locator("#contact-new-password").fill(contact.password);
    await page.locator("#contact-new-password-confirm").fill(contact.password);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/contact-invitations/accept") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "接受邀请并生成联系人密钥" }).click();
    expect((await responsePromise).status()).toBe(201);
    await expect(page.locator(".dls-toast")).toContainText("注册已完成");
    await registerLiveContactSecrets(secrets, {
      label: `browser-contact-${contact.email}`,
      password: contact.password,
      material: await material(page),
    });
    await context.storageState({ path: storageStatePath });
  } finally {
    await context.close();
  }
}

async function activateNewGeneration(app: DlsApp, ownerPassword: string, expectedCount: number) {
  await app.open("/admin/contacts");
  await expect(app.page.getByRole("heading", { name: "联系人集合已变更" })).toBeVisible();
  await app.page.locator("#share-generation-owner-password").fill(ownerPassword);
  const responsePromise = app.page.waitForResponse(
    (response) =>
      /\/api\/owner\/vault\/share-generations\/[^/]+\/activate$/u.test(response.url()) &&
      response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "生成并激活新分片代次" }).click();
  expect((await responsePromise).status()).toBe(201);
  await expect(app.page.locator(".dls-toast")).toContainText("新分片代次已生成并激活");
  await app.open("/admin/contacts");
  await expect(app.page.locator(".dls-contact-card").filter({ hasText: "ACTIVE" })).toHaveCount(
    expectedCount,
  );
}

async function material(page: Page): Promise<CryptoMaterial> {
  return page.evaluate(async () => {
    const response = await fetch("/api/contact/crypto-material");
    if (!response.ok) throw new Error(`crypto material failed with ${response.status}`);
    return (await response.json()).data as CryptoMaterial;
  });
}

async function activeDeathShare(
  state: E2EStackState,
  contactId: string,
): Promise<LiveContactShare> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(contactId)) {
    throw new Error("contact id is invalid");
  }
  const rows = await queryPostgres(
    state,
    `SELECT concat_ws('|', s.generation_id::text, s.share_index::text, g.death_threshold::text, encode(s.death_share_ciphertext, 'hex'), encode(s.death_share_commitment, 'hex')) FROM app.contact_key_shares AS s JOIN app.share_generations AS g ON g.id = s.generation_id JOIN app.vaults AS v ON v.active_share_generation_id = g.id WHERE s.contact_id = '${contactId}'::uuid AND g.status = 'ACTIVE'`,
  );
  if (rows.length !== 1) throw new Error("active contact death share is unavailable");
  const [generationId, shareIndexText, thresholdText, ciphertextHex, commitmentHex] = (
    rows[0] ?? ""
  ).split("|");
  const shareIndex = Number(shareIndexText);
  const threshold = Number(thresholdText);
  if (
    generationId === undefined ||
    ciphertextHex === undefined ||
    commitmentHex === undefined ||
    !Number.isSafeInteger(shareIndex) ||
    !Number.isSafeInteger(threshold)
  ) {
    throw new Error("active contact death share is invalid");
  }
  return {
    purpose: "death-share",
    generationId,
    shareIndex,
    threshold,
    ciphertext: Buffer.from(ciphertextHex, "hex").toString("base64url"),
    commitment: Buffer.from(commitmentHex, "hex").toString("base64url"),
  };
}

test("rotates a contact password, removes and reinvites the contact, and regenerates shares", async ({
  app,
  browser,
  cryptoUsers,
  mailpit,
  secrets,
}) => {
  const contact = cryptoUsers.contacts[0];
  if (contact === undefined) throw new Error("the first contact fixture is unavailable");
  const state = await readE2EState();

  const contactContext = await createSecretCheckedContext(browser, secrets, {
    storageState: contactStateFile(0),
  });
  let preRotationMaterial!: CryptoMaterial;
  try {
    const page = await contactContext.newPage();
    await page.goto("/contact/password-change", { waitUntil: "networkidle" });
    const staleSession = await contactContext.storageState();
    preRotationMaterial = await material(page);
    await registerLiveContactSecrets(secrets, {
      label: "browser-contact-1-before-rotation",
      password: contact.password,
      material: preRotationMaterial,
    });
    await page.locator("#contact-old-password").fill(contact.password);
    await page.locator("#contact-change-password").fill(contact.rotatedPassword);
    await page.locator("#contact-change-confirm").fill(contact.rotatedPassword);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/contacts/password-change/complete") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "重新包装联系人私钥并修改密码" }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page.locator(".dls-toast")).toContainText("历史分片仍然有效");
    const postRotationMaterial = await material(page);
    await registerLiveContactSecrets(secrets, {
      label: "browser-contact-1-after-rotation",
      password: contact.rotatedPassword,
      material: postRotationMaterial,
      shares: [await activeDeathShare(state, postRotationMaterial.contactId)],
    });
    expect(postRotationMaterial.publicKey).toBe(preRotationMaterial.publicKey);
    expect(postRotationMaterial.keyId).toBe(preRotationMaterial.keyId);
    expect(postRotationMaterial.privateKeyEnvelope).not.toEqual(
      preRotationMaterial.privateKeyEnvelope,
    );
    await contactContext.storageState({ path: contactStateFile(0) });

    const staleContext = await createSecretCheckedContext(browser, secrets, {
      storageState: staleSession,
    });
    try {
      const stalePage = await staleContext.newPage();
      await stalePage.goto("/contact/password-change", { waitUntil: "domcontentloaded" });
      expect(
        await stalePage.evaluate(() =>
          fetch("/api/contact/crypto-material").then((response) => response.status),
        ),
      ).toBe(401);
    } finally {
      await staleContext.close();
    }
  } finally {
    await contactContext.close();
  }

  const loginContext = await createSecretCheckedContext(browser, secrets);
  try {
    const page = await loginContext.newPage();
    await page.goto("/contact/login", { waitUntil: "networkidle" });
    await page.locator("#contact-name").fill(contact.displayName);
    await page.locator("#contact-password").fill(contact.password);
    let responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/contact/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "联系人登录" }).click();
    expect((await responsePromise).status()).toBe(401);
    await page.locator("#contact-password").fill(contact.rotatedPassword);
    responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/contact/login") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "联系人登录" }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/contact\/workflows\/current$/u);
    await loginContext.storageState({ path: contactStateFile(0) });
  } finally {
    await loginContext.close();
  }

  await invite(app, cryptoUsers.rotationContact);
  const rotationMail = await mailpit.waitFor({
    recipient: cryptoUsers.rotationContact.email,
    subject: /./u,
  });
  const rotationInvitation = extractFragmentLink(rotationMail.HTML, state.baseUrl);
  const rotationInvitationToken = new URLSearchParams(rotationInvitation.hash.slice(1)).get(
    "invite",
  );
  if (rotationInvitationToken === null) throw new Error("rotation invitation token is unavailable");
  secrets.register("rotation-contact-invitation-token", rotationInvitationToken, {
    allowedOn: ["mailpit"],
  });
  await acceptInvitation(
    browser,
    secrets,
    rotationInvitation.href,
    cryptoUsers.rotationContact,
    contactStateFile(3),
  );
  await activateNewGeneration(app, cryptoUsers.owner.recoveryPassword, 4);

  await app.open("/admin/contacts");
  const contactRow = app.page.locator("tbody tr").filter({ hasText: contact.displayName });
  await contactRow.getByRole("button", { name: "移除联系人" }).click();
  await app.page.locator("#remove-contact-owner-password").fill(cryptoUsers.owner.recoveryPassword);
  const removeResponsePromise = app.page.waitForResponse(
    (response) =>
      /\/api\/owner\/contacts\/[^/]+\/remove$/u.test(response.url()) &&
      response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "确认移除联系人" }).click();
  expect((await removeResponsePromise).status()).toBe(200);
  await expect(app.page.locator(".dls-toast")).toContainText("已移除");

  const seenMessages = new Set((await mailpit.messages()).map((message) => message.ID));
  const reinvited: ContactInput = {
    displayName: contact.displayName,
    email: contact.email,
    password: contact.reinvitedPassword,
  };
  await invite(app, reinvited);
  const reinvitationMail = await mailpit.waitFor({
    recipient: contact.email,
    subject: /./u,
    excludeMessageIds: seenMessages,
  });
  const reinvitation = extractFragmentLink(reinvitationMail.HTML, state.baseUrl);
  const reinvitationToken = new URLSearchParams(reinvitation.hash.slice(1)).get("invite");
  if (reinvitationToken === null) throw new Error("reinvitation token is unavailable");
  secrets.register("reinvited-contact-invitation-token", reinvitationToken, {
    allowedOn: ["mailpit"],
  });
  await acceptInvitation(browser, secrets, reinvitation.href, reinvited, contactStateFile(0));
  await activateNewGeneration(app, cryptoUsers.owner.recoveryPassword, 4);

  const reinvitedContext = await createSecretCheckedContext(browser, secrets, {
    storageState: contactStateFile(0),
  });
  try {
    const page = await reinvitedContext.newPage();
    await page.goto("/contact/password-change", { waitUntil: "networkidle" });
    expect((await material(page)).publicKey).not.toBe(preRotationMaterial.publicKey);
  } finally {
    await reinvitedContext.close();
  }
});
