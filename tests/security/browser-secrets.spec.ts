import { expect, test } from "@playwright/test";

test("fragment entry tokens disappear from history, DOM, storage, console, caches, and request URLs", async ({
  page,
}) => {
  const secret = "fragment-entry-secret-should-disappear";
  const consoleMessages: string[] = [];
  const requestUrls: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  page.on("request", (request) => requestUrls.push(request.url()));
  await page.addInitScript(() => {
    const writes: string[] = [];
    const original = history.replaceState.bind(history);
    history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      writes.push(String(url ?? ""));
      return original(data, unused, url);
    }) as History["replaceState"];
    Object.defineProperty(window, "__dlsHistoryWrites", { value: writes });
  });

  await page.goto(`/contact/login#entry=${secret}`, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/contact\/login$/u);

  const evidence = await page.evaluate(async () => ({
    html: document.documentElement.outerHTML,
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
    finalHistoryWrite: (
      window as unknown as { __dlsHistoryWrites: string[] }
    ).__dlsHistoryWrites.at(-1),
    currentUrl: location.href,
    cacheKeys: "caches" in window ? await caches.keys() : [],
    resources: performance.getEntriesByType("resource").map((entry) => entry.name),
  }));
  expect(JSON.stringify(evidence)).not.toContain(secret);
  expect(consoleMessages.join("\n")).not.toContain(secret);
  expect(requestUrls.join("\n")).not.toContain(secret);
});

test("a strict CSRF cookie survives reload and is attached without local or session storage", async ({
  page,
}) => {
  const csrf = "csrf-cookie-after-reload";
  const password = "owner-password-not-for-url-or-storage";
  await page
    .context()
    .addCookies([
      { name: "dls-owner-csrf", value: csrf, url: "http://127.0.0.1:4173", sameSite: "Strict" },
    ]);
  await page.goto("/admin", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });

  const passwordField = page.locator("#dashboard-password-desktop");
  await passwordField.fill(password);
  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith("/api/owner/check-ins"),
  );
  await page.getByRole("button", { name: "验证签到" }).click();
  const request = await requestPromise;
  expect(request.headers()["x-csrf-token"]).toBe(csrf);
  expect(request.url()).not.toContain(password);
  await expect(passwordField).toHaveValue("");
  const browserState = await page.evaluate(async () => ({
    localStorage: Object.entries(localStorage),
    sessionStorage: Object.entries(sessionStorage),
    cacheKeys: "caches" in window ? await caches.keys() : [],
    url: location.href,
  }));
  expect(JSON.stringify(browserState)).not.toContain(password);
  expect(browserState.localStorage).toEqual([]);
  expect(browserState.sessionStorage).toEqual([]);
});
