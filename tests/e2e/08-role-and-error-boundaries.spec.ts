import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/app.js";
import { createSecretCheckedContext } from "./fixtures/assert-no-secrets.js";
import { queryPostgres } from "./fixtures/compose.js";
import { contactStateFile, readE2EState } from "./stack-state.js";

type BrowserResponse = Readonly<{ status: number; body: unknown }>;

async function response(page: Page, path: string, init?: RequestInit): Promise<BrowserResponse> {
  return page.evaluate(
    async ({ path, init }) => {
      const result = await fetch(path, init);
      const text = await result.text();
      let body: unknown = text;
      try {
        body = text.length === 0 ? undefined : JSON.parse(text);
      } catch {
        // Preserve non-JSON error bodies for leak checks.
      }
      return { status: result.status, body };
    },
    { path, init },
  );
}

function canonicalError(value: unknown): string {
  return JSON.stringify(value, (key, item) =>
    ["requestId", "timestamp", "path"].includes(key) ? undefined : item,
  );
}

function expectNoPrivateData(body: unknown, secrets: readonly string[]): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  for (const secret of secrets) expect(text).not.toContain(secret);
}

test("fails role-cookie cross-use, unknown resources, and enumeration attempts closed", async ({
  app,
  browser,
  cryptoUsers,
  secrets,
}) => {
  const privateValues = [
    cryptoUsers.owner.email,
    cryptoUsers.owner.password,
    cryptoUsers.owner.recoveryPassword,
    ...cryptoUsers.contacts.flatMap((contact) => [
      contact.email,
      contact.password,
      contact.rotatedPassword,
      contact.reinvitedPassword,
    ]),
    cryptoUsers.rotationContact.email,
    cryptoUsers.rotationContact.password,
  ];

  const ownerAsContact = await response(app.page, "/api/contact/workflows/current");
  expect(ownerAsContact.status).toBe(401);
  expectNoPrivateData(ownerAsContact.body, privateValues);

  const contactContext = await createSecretCheckedContext(browser, secrets, {
    storageState: contactStateFile(0),
  });
  try {
    const page = await contactContext.newPage();
    await page.goto("/contact/workflows/current", { waitUntil: "networkidle" });
    await expect(page.getByText("没有当前任务")).toBeVisible();
    const contactAsOwner = await response(page, "/api/owner/contacts");
    expect(contactAsOwner.status).toBe(401);
    expectNoPrivateData(contactAsOwner.body, privateValues);

    await page.goto("/admin/contacts", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login$/u);
    expectNoPrivateData(await page.locator("body").innerText(), privateValues);
  } finally {
    await contactContext.close();
  }

  const anonymousContext = await createSecretCheckedContext(browser, secrets);
  try {
    const page = await anonymousContext.newPage();
    await page.goto("/contact/workflows/current", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/contact\/login$/u);
    await page.goto("/admin/contacts", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/login$/u);
    expectNoPrivateData(await page.locator("body").innerText(), privateValues);
  } finally {
    await anonymousContext.close();
  }

  const state = await readE2EState();
  const removedIds = await queryPostgres(
    state,
    "SELECT id::text FROM app.emergency_contacts WHERE status = 'REMOVED' ORDER BY removed_at DESC LIMIT 1",
  );
  const removedId = removedIds[0];
  expect(removedId).toMatch(/^[0-9a-f-]{36}$/u);
  if (removedId === undefined) throw new Error("removed contact fixture is unavailable");

  const removalErrors = await app.page.evaluate(
    async ({ ids, password }) => {
      const csrf = document.cookie
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith("dls-owner-csrf="))
        ?.slice("dls-owner-csrf=".length);
      return Promise.all(
        ids.map(async (contactId) => {
          const result = await fetch(`/api/owner/contacts/${contactId}/remove`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": decodeURIComponent(csrf ?? ""),
            },
            body: JSON.stringify({ password }),
          });
          return { status: result.status, body: await result.json() };
        }),
      );
    },
    {
      ids: [removedId, "00000000-0000-4000-8000-00000000dead"],
      password: cryptoUsers.owner.recoveryPassword,
    },
  );
  expect(removalErrors.map((item) => item.status)).toEqual([404, 404]);
  expect(canonicalError(removalErrors[0]?.body)).toBe(canonicalError(removalErrors[1]?.body));
  for (const item of removalErrors) expectNoPrivateData(item.body, privateValues);

  const loginErrors = await app.page.evaluate(
    async ({ existingName, password }) =>
      Promise.all(
        [existingName, "No Such Contact"].map(async (displayName) => {
          const result = await fetch("/api/auth/contact/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ displayName, password }),
          });
          return { status: result.status, body: await result.json() };
        }),
      ),
    {
      existingName: cryptoUsers.contacts[1]?.displayName ?? "E2E Contact Two",
      password: "deliberately-wrong-contact-password",
    },
  );
  expect(loginErrors.map((item) => item.status)).toEqual([401, 401]);
  expect(canonicalError(loginErrors[0]?.body)).toBe(canonicalError(loginErrors[1]?.body));
  for (const item of loginErrors) expectNoPrivateData(item.body, privateValues);

  const unknownApi = await response(
    app.page,
    "/api/owner/not-a-real-resource/00000000-0000-4000-8000-00000000dead",
  );
  expect(unknownApi.status).toBe(404);
  expectNoPrivateData(unknownApi.body, privateValues);
  await app.page.goto("/admin/does-not-exist", { waitUntil: "networkidle" });
  await expect(app.page.getByText("404").first()).toBeVisible();
  expectNoPrivateData(await app.page.locator("body").innerText(), privateValues);
});
