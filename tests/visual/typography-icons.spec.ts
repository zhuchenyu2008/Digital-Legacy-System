import { expect, test } from "@playwright/test";
import { selectScenario } from "./visual-helpers.js";

test("uses the supplied Inter, JetBrains Mono, and Material Symbols visual language", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await selectScenario(page, "admin");
  await page.goto("/admin", { waitUntil: "networkidle" });

  await expect(page.locator("html")).toHaveClass(/dls-material-symbols-ready/);

  const typography = await page.evaluate(() => {
    const status = document.querySelector(".dls-status");
    return {
      body: getComputedStyle(document.body).fontFamily,
      mono: status === null ? "" : getComputedStyle(status).fontFamily,
    };
  });
  expect(typography.body).toContain("Inter");
  expect(typography.mono).toContain("JetBrains Mono");

  const icon = page.locator(".dls-checkin-fingerprint .dls-icon").first();
  await expect(icon.locator(".material-symbols-outlined")).toBeVisible();
  await expect(icon.locator(".dls-icon__fallback")).toBeHidden();
  await expect(icon).toHaveCSS("width", "54px");
  await expect(icon).toHaveCSS("height", "54px");
});
