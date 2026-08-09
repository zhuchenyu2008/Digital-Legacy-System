import { expect, test } from "@playwright/test";
import { selectScenario } from "../visual/visual-helpers.js";

test("keeps selected API fixtures isolated between browser contexts", async ({ browser }) => {
  const releaseContext = await browser.newContext();
  const adminContext = await browser.newContext();

  try {
    const releasePage = await releaseContext.newPage();
    const adminPage = await adminContext.newPage();

    await selectScenario(releasePage, "release");
    await selectScenario(adminPage, "admin");
    await Promise.all([
      releasePage.goto("/admin/workflows/current", { waitUntil: "networkidle" }),
      adminPage.goto("/admin/files", { waitUntil: "networkidle" }),
    ]);

    await expect(releasePage.locator(".dls-critical-banner")).toBeVisible();
    await expect(adminPage.locator(".dls-encryption-ready")).toBeVisible();
  } finally {
    await releaseContext.close();
    await adminContext.close();
  }
});
