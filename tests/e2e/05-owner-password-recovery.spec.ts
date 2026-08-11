import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/app.js";
import {
  createSecretCheckedContext,
  type LiveContactCryptoMaterial,
  registerLiveContactSecrets,
} from "./fixtures/assert-no-secrets.js";
import { extractFragmentLink } from "./fixtures/mailpit.js";
import { contactStateFile, readE2EState } from "./stack-state.js";

type Schedule = Readonly<{ lastCheckInAt: string | null; deadlineAt: string }>;

async function schedule(page: Page): Promise<Schedule> {
  return page.evaluate(async () => {
    const response = await fetch("/api/owner/check-in-schedule");
    if (!response.ok) throw new Error(`schedule failed with ${response.status}`);
    return (await response.json()).data as Schedule;
  });
}

test("recovers the owner password through real contact shares and a one-time browser key", async ({
  app,
  browser,
  cryptoUsers,
  mailpit,
  secrets,
}) => {
  const before = await schedule(app.page);
  const state = await readE2EState();

  await app.open("/password-recovery");
  const requestResponse = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/owner/password-recovery/request") &&
      response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "请求主密码恢复" }).click();
  expect((await requestResponse).status()).toBe(202);

  const startMail = await mailpit.waitFor({
    recipient: cryptoUsers.owner.email,
    subject: /确认启动主密码恢复/u,
  });
  const startLink = extractFragmentLink(startMail.HTML, state.baseUrl);
  expect(startLink.pathname).toBe("/password-recovery");
  const startToken = new URLSearchParams(startLink.hash.slice(1)).get("recovery");
  expect(startToken).toBeTruthy();
  if (startToken === null) throw new Error("recovery start token is unavailable");
  secrets.register("recovery-start-token", startToken, { allowedOn: ["mailpit"] });

  await app.page.goto(startLink.href, { waitUntil: "networkidle" });
  const startResponsePromise = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/owner/password-recovery/start") &&
      response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "启动恢复流程" }).click();
  const startResponse = await startResponsePromise;
  expect(startResponse.status()).toBe(200);
  const started = (await startResponse.json()) as {
    data: { workflowId: string; requiredCount: number };
  };
  expect(started.data.requiredCount).toBe(2);
  const replayStartStatus = await app.page.evaluate(async (token) => {
    const response = await fetch("/api/auth/owner/password-recovery/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return response.status;
  }, startToken);
  expect([400, 404, 409]).toContain(replayStartStatus);
  await expect(app.page.getByRole("heading", { name: "等待联系人审批" })).toBeVisible();
  expect((await schedule(app.page)).deadlineAt).toBe(before.deadlineAt);

  for (const index of [0, 1]) {
    const contact = cryptoUsers.contacts[index];
    if (contact === undefined) throw new Error(`contact ${index + 1} is unavailable`);
    const contactMail = await mailpit.waitFor({
      recipient: contact.email,
      subject: /请协助.+恢复主密码/u,
    });
    const contactLink = extractFragmentLink(contactMail.HTML, state.baseUrl);
    expect(contactLink.pathname).toBe("/contact/login");
    expect(new URLSearchParams(contactLink.hash.slice(1)).get("entry")).toBe(
      started.data.workflowId,
    );

    const context = await createSecretCheckedContext(browser, secrets, {
      storageState: contactStateFile(index),
    });
    try {
      const page = await context.newPage();
      await page.goto("/contact/workflows/current", { waitUntil: "networkidle" });
      const live = await page.evaluate(async () => {
        const [materialResponse, workflowResponse] = await Promise.all([
          fetch("/api/contact/crypto-material"),
          fetch("/api/contact/workflows/current"),
        ]);
        if (!materialResponse.ok || !workflowResponse.ok) {
          throw new Error(
            `live recovery material failed with ${materialResponse.status}/${workflowResponse.status}`,
          );
        }
        return {
          material: ((await materialResponse.json()) as { data: LiveContactCryptoMaterial }).data,
          workflow: (await workflowResponse.json()) as {
            workflowId: string;
            requiredCount: number;
            share: {
              generationId: string;
              shareIndex: number;
              ciphertext: string;
              commitment: string;
            };
          },
        };
      });
      expect(live.workflow.workflowId).toBe(started.data.workflowId);
      await registerLiveContactSecrets(secrets, {
        label: `browser-recovery-contact-${index + 1}`,
        password: contact.password,
        material: live.material,
        shares: [
          {
            purpose: "recovery-share",
            generationId: live.workflow.share.generationId,
            shareIndex: live.workflow.share.shareIndex,
            threshold: live.workflow.requiredCount,
            ciphertext: live.workflow.share.ciphertext,
            commitment: live.workflow.share.commitment,
          },
        ],
      });
      await expect(page.getByText("PASSWORD RECOVERY / ACTION REQUIRED")).toBeVisible();
      await page.getByRole("button", { name: "审核并批准恢复" }).click();
      await page.locator('.dls-check input[type="checkbox"]').check();
      await page.locator("#recovery-contact-password").fill(contact.password);
      const approvalResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(
              `/api/contact/workflows/${started.data.workflowId}/approve-password-recovery`,
            ) && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "确认批准密码恢复" }).click();
      expect((await approvalResponsePromise).status()).toBe(202);
      await expect(page.getByText("你的决定已提交")).toBeVisible();
    } finally {
      await context.close();
    }
  }

  expect((await schedule(app.page)).deadlineAt).toBe(before.deadlineAt);
  const resetMail = await mailpit.waitFor({
    recipient: cryptoUsers.owner.email,
    subject: /联系人门限已达到，请设置新主密码/u,
  });
  const resetLink = extractFragmentLink(resetMail.HTML, state.baseUrl);
  const resetFragment = new URLSearchParams(resetLink.hash.slice(1));
  const resetToken = resetFragment.get("recovery");
  const resetCode = resetFragment.get("code");
  expect(resetToken).toBeTruthy();
  expect(resetCode).toMatch(/^\d{8}$/u);
  if (resetToken === null || resetCode === null) {
    throw new Error("recovery reset token or code is unavailable");
  }
  secrets.register("recovery-reset-token", resetToken, { allowedOn: ["mailpit"] });
  secrets.register("recovery-reset-code", resetCode, { allowedOn: ["mailpit"] });

  await app.page.goto(resetLink.href, { waitUntil: "networkidle" });
  await expect(app.page.locator("#recovery-new-password")).toBeVisible();
  expect(app.page.url()).not.toContain("#");
  await app.page.locator("#recovery-new-password").fill(cryptoUsers.owner.recoveryPassword);
  await app.page.locator("#recovery-confirm-password").fill(cryptoUsers.owner.recoveryPassword);
  const resetResponsePromise = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/owner/password-recovery/reset") &&
      response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "完成主密码重置" }).click();
  const resetResponse = await resetResponsePromise;
  expect(resetResponse.status()).toBe(200);
  const resetRequestBody = resetResponse.request().postDataJSON();
  const replayResetStatus = await app.page.evaluate(async (body) => {
    const response = await fetch("/api/auth/owner/password-recovery/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.status;
  }, resetRequestBody);
  expect([400, 404, 409]).toContain(replayResetStatus);
  await expect(app.page.getByText("恢复步骤已完成")).toBeVisible();

  const revoked = await app.page.evaluate(() =>
    fetch("/api/owner/check-in-schedule").then((response) => response.status),
  );
  expect(revoked).toBe(401);

  await app.open("/login");
  await app.page.locator("#owner-password").fill(cryptoUsers.owner.password);
  const oldLoginResponse = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/owner/login") && response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "管理员登录" }).click();
  expect((await oldLoginResponse).status()).toBe(401);
  await expect(app.page).toHaveURL(/\/login$/u);

  await app.page.locator("#owner-password").fill(cryptoUsers.owner.recoveryPassword);
  const newLoginResponsePromise = app.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/owner/login") && response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "管理员登录" }).click();
  const newLoginResponse = await newLoginResponsePromise;
  expect(newLoginResponse.status()).toBe(200);
  await expect(app.page).toHaveURL(/\/admin(?:\/|$)/u);

  const after = await schedule(app.page);
  expect(Date.parse(after.deadlineAt)).toBeGreaterThanOrEqual(Date.parse(before.deadlineAt));
  const ownerStateFile = process.env.DLS_E2E_OWNER_STATE_FILE;
  if (ownerStateFile === undefined) throw new Error("DLS_E2E_OWNER_STATE_FILE is required");
  await app.page.context().storageState({ path: ownerStateFile });
});
