import { expect, test } from "@playwright/test";

test("pages emit a restrictive CSP and load no third-party JavaScript", async ({ page }) => {
  const response = await page.goto("/admin", { waitUntil: "networkidle" });
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
  expect(csp).not.toMatch(/script-src[^;]*'wasm-unsafe-eval'/u);
  expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/u);
  expect(csp).toMatch(/script-src[^;]*'strict-dynamic'/u);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/u);
  expect(csp).not.toMatch(/script-src[^;]*https?:\/\//u);

  const scripts = await page
    .locator("script[src]")
    .evaluateAll((elements) => elements.map((element) => (element as HTMLScriptElement).src));
  const pageOrigin = new URL(page.url()).origin;
  expect(scripts.every((url) => new URL(url).origin === pageOrigin)).toBe(true);
  expect(
    await page
      .locator("script")
      .evaluateAll((elements) => elements.every((element) => element.hasAttribute("nonce"))),
  ).toBe(true);
  expect(await page.content()).not.toContain("cdn.tailwindcss.com");
});

test("WASM compilation is allowed only on routes that instantiate the crypto worker", async ({
  page,
}) => {
  const cryptoRoute = await page.goto("/admin/contacts", { waitUntil: "networkidle" });
  expect(cryptoRoute?.headers()["content-security-policy"]).toMatch(
    /script-src[^;]*'wasm-unsafe-eval'/u,
  );
  const ordinaryRoute = await page.goto("/admin/health", { waitUntil: "networkidle" });
  expect(ordinaryRoute?.headers()["content-security-policy"]).not.toMatch(
    /script-src[^;]*'wasm-unsafe-eval'/u,
  );
});

test("the public legacy route emits anti-indexing headers", async ({ page }) => {
  const response = await page.goto("/legacy", { waitUntil: "networkidle" });
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
});
