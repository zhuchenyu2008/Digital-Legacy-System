import { expect, test } from "@playwright/test";
import { selectScenario } from "./visual-helpers.js";

test("uses the supplied typography and keeps one icon renderer visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await selectScenario(page, "admin");
  await page.goto("/admin", { waitUntil: "networkidle" });

  const typography = await page.evaluate(() => {
    const status = document.querySelector(".dls-status");
    const material = document.querySelector(".dls-checkin-fingerprint .material-symbols-outlined");
    const fallback = document.querySelector(".dls-checkin-fingerprint .dls-icon__fallback");
    return {
      body: getComputedStyle(document.body).fontFamily,
      mono: status === null ? "" : getComputedStyle(status).fontFamily,
      materialVisible: material === null ? false : getComputedStyle(material).display !== "none",
      fallbackVisible: fallback === null ? false : getComputedStyle(fallback).display !== "none",
    };
  });
  expect(typography.body).toContain("Inter");
  expect(typography.mono).toContain("JetBrains Mono");
  expect(typography.materialVisible).not.toBe(typography.fallbackVisible);

  const icon = page.locator(".dls-checkin-fingerprint .dls-icon").first();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveCSS("width", "54px");
  await expect(icon).toHaveCSS("height", "54px");
});
