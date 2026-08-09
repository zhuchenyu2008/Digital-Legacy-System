import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { DESIGN_SOURCES } from "./design-sources.js";
import { captureDesign } from "./visual-helpers.js";

async function verifySampleStructure(page: import("@playwright/test").Page, id: string) {
  if (id === "02") {
    await expect(page.locator(".dls-contact-threshold")).toBeVisible();
    await expect(page.locator(".dls-contact-guidance")).toBeVisible();
    await expect(
      page.locator(".dls-app-shell > .dls-desktop-header .dls-header-inner nav"),
    ).toBeHidden();
    await expect(page.locator(".dls-contact-network > .dls-editor")).toBeVisible();
  }
  if (id === "03") {
    await expect(page.locator(".dls-encryption-ready")).toBeVisible();
    await expect(page.locator(".dls-will-preview")).toBeVisible();
    await expect(page.locator(".dls-package-summary")).toBeVisible();
    await expect(page.locator("label.dls-upload-drop")).toBeVisible();
    await expect(page.getByText("点击或拖拽 ZIP 文件至此")).toBeVisible();
    await expect(page.locator(".dls-package-activation")).toBeVisible();
  }
  if (id === "06") {
    await expect(page.locator(".dls-settings-profile")).toBeVisible();
    await expect(page.locator(".dls-settings-security")).toBeVisible();
    await expect(page.locator(".dls-settings-footer")).toBeVisible();
    await expect(page.locator(".dls-settings-desktop-copy").first()).toBeVisible();
    await expect(page.locator(".dls-settings-mobile-copy").first()).toBeHidden();
    await expect(
      page.locator(".dls-app-shell > .dls-desktop-header .dls-header-notifications"),
    ).toBeVisible();
    await expect(
      page.locator('.dls-app-shell > .dls-desktop-header nav a[href="/admin/settings"]'),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".dls-settings-profile-fields input")).toHaveCount(3);
    const workspaceWidth = await page
      .locator(".dls-workspace")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(workspaceWidth).toBeGreaterThanOrEqual(840);
    expect(workspaceWidth).toBeLessThanOrEqual(880);
    const profileColumnCount = await page
      .locator(".dls-settings-profile-fields")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      );
    expect(profileColumnCount).toBe(2);
    const coreColumnCount = await page
      .locator(".dls-settings-core-fields")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      );
    expect(coreColumnCount).toBe(2);
    const columnCount = await page
      .locator(".dls-settings-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      );
    expect(columnCount).toBe(1);
    await expect(page.locator(".dls-settings-profile .dls-settings-desktop-copy")).toHaveCSS(
      "display",
      "flex",
    );
    await expect(page.locator(".dls-settings-profile .dls-settings-desktop-copy")).toHaveCSS(
      "column-gap",
      "9px",
    );
  }
  if (id === "04") {
    await expect(page.locator(".dls-smtp-facts")).toBeVisible();
    await expect(page.locator(".dls-settings-security")).toBeVisible();
    await expect(page.locator(".dls-settings-mobile-copy").first()).toBeVisible();
    await expect(page.locator(".dls-settings-desktop-copy").first()).toBeHidden();
    await expect(page.locator(".dls-mobile-brand .dls-header-notifications")).toBeHidden();
    await expect(page.locator(".dls-settings-mobile-summary")).toBeVisible();
    await expect(page.locator(".dls-settings-desktop-form")).toBeHidden();
    await expect(page.locator(".dls-settings-profile-action")).toBeHidden();
    await expect(page.locator('.dls-mobile-nav a[href="/admin/settings"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".dls-settings-footer")).toBeHidden();
  }
  if (id === "08") {
    await expect(page.locator(".dls-dashboard-mobile-rings")).toBeVisible();
    await expect(page.locator(".dls-checkin-fingerprint")).toBeVisible();
    await expect(page.locator('.dls-mobile-nav a[href="/admin"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator(".dls-dashboard-grid")).toBeHidden();
  }
  if (id === "10") {
    await expect(page.locator(".dls-dashboard > .dls-page-heading")).toBeHidden();
    await expect(page.locator(".dls-dashboard-countdown")).toBeVisible();
    await expect(page.locator(".dls-checkin-form input[type=password]")).toBeVisible();
    await expect(page.locator(".dls-dashboard-overview")).toBeVisible();
    await expect(page.locator(".dls-dashboard-audit")).toBeVisible();
    const workspaceWidth = await page
      .locator(".dls-workspace")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(workspaceWidth).toBeGreaterThanOrEqual(1180);
    expect(workspaceWidth).toBeLessThanOrEqual(1200);
  }
  if (id === "09") {
    await expect(page.locator(".dls-public-death-header")).toBeVisible();
    await expect(page.locator(".dls-public-death-header nav a")).toHaveCount(4);
    await expect(page.locator(".dls-public-death-status")).toContainText("ARMED - 确认中");
    await expect(page.locator(".dls-death-ring svg")).toBeVisible();
    await expect(page.locator(".dls-public-threshold-tags")).toBeVisible();
    await expect(page.locator(".dls-public-protocol-visual")).toBeVisible();
    await expect(page.locator(".dls-public-admin-action")).toBeVisible();
    await expect(page.locator(".dls-public-chain li")).toHaveCount(3);
  }
  if (id === "11") {
    await expect(page.locator(".dls-public-death-header .dls-public-death-status")).toBeVisible();
    await expect(page.locator(".dls-public-death-header .dls-header-notifications")).toBeVisible();
    await expect(page.locator(".dls-death-ring svg")).toBeVisible();
    await expect(page.locator(".dls-public-mobile-nav .dls-icon")).toHaveCount(4);
  }
  if (id === "05") {
    await expect(page.locator(".dls-critical-banner")).toContainText(
      "SYSTEM STATUS: RELEASE PENDING",
    );
    await expect(page.locator(".dls-countdown-units span")).toHaveCount(3);
    await expect(page.locator(".dls-cancel-hold-button")).toHaveAttribute(
      "data-hold-required",
      "3000",
    );
    await expect(page.locator(".dls-mobile-nav")).toBeVisible();
  }
  if (id === "16") {
    await expect(page.locator(".dls-app-shell > .dls-desktop-header .dls-status")).toContainText(
      "ARMED (PENDING)",
    );
    await expect(page.locator(".dls-critical-banner")).toContainText(
      "SYSTEM STATUS: RELEASE PENDING",
    );
    await expect(page.locator(".dls-countdown-units span")).toHaveCount(3);
    await expect(page.locator(".dls-cancel-hold-button")).toHaveAttribute(
      "data-hold-required",
      "3000",
    );
    const workspaceWidth = await page
      .locator(".dls-workspace")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(workspaceWidth).toBeGreaterThanOrEqual(930);
    expect(workspaceWidth).toBeLessThanOrEqual(944);
  }
  if (id === "12") {
    await expect(page.locator(".dls-legacy-topbar")).toBeVisible();
    await expect(page.locator(".dls-legacy-topbar .dls-public-node .dls-icon")).toBeVisible();
    await expect(page.locator(".dls-legacy-hero > .dls-robots .dls-icon")).toBeVisible();
    await expect(page.locator(".dls-will-file .dls-icon")).toBeVisible();
    await expect(page.locator(".dls-copy-will")).toBeVisible();
    await expect(page.locator(".dls-download-heading .dls-icon")).toBeVisible();
    await expect(page.locator(".dls-public-audit > h2 .dls-icon")).toBeVisible();
    const contentWidth = await page
      .locator(".dls-legacy-content")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(contentWidth).toBeGreaterThanOrEqual(940);
    expect(contentWidth).toBeLessThanOrEqual(948);
    const legacyColumns = await page
      .locator(".dls-legacy-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      );
    expect(legacyColumns).toBe(2);
    const willHeight = await page
      .locator(".dls-will")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(willHeight).toBeGreaterThanOrEqual(690);
    expect(willHeight).toBeLessThanOrEqual(710);
    await expect(page.locator(".dls-download-icon").first()).toHaveCSS(
      "background-color",
      "rgb(108, 248, 187)",
    );
    await expect(page.locator(".dls-download-icon").first()).toHaveCSS("color", "rgb(0, 113, 77)");
    await expect(page.locator(".dls-download-icon").first()).toHaveCSS("border-radius", "8px");
  }
  if (id === "13") {
    await expect(page.locator(".dls-legacy-topbar")).toBeHidden();
    await expect(page.locator(".dls-legacy-hero .dls-release-badge--mobile")).toBeVisible();
    await expect(page.locator(".dls-legacy-hero > .dls-robots")).toBeVisible();
    await expect(page.locator(".dls-copy-will")).toBeHidden();
    const legacyColumns = await page
      .locator(".dls-legacy-grid")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
      );
    expect(legacyColumns).toBe(1);
    const willHeight = await page
      .locator(".dls-will")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(willHeight).toBeGreaterThanOrEqual(510);
    const downloadTop = await page
      .locator(".dls-download-box")
      .first()
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(downloadTop).toBeGreaterThanOrEqual(815);
  }
  if (id === "14") {
    await expect(page.locator(".email-stage2")).toBeVisible();
    await expect(page.locator(".email-brand-icon")).toBeVisible();
    await expect(page.locator(".email-urgent-badge")).toBeVisible();
    await expect(page.locator(".email-countdown")).toBeVisible();
    await expect(page.locator(".email-action-arrow")).toBeVisible();
    await expect(page.locator(".email-template-footer")).toBeVisible();
    await expect(page.locator(".email-stage2 h1")).toHaveCount(0);
    const shellHeight = await page
      .locator(".email-shell")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(shellHeight).toBeGreaterThanOrEqual(820);
    expect(shellHeight).toBeLessThanOrEqual(880);
  }
  if (id === "15") {
    await expect(page.locator(".email-confirmation")).toBeVisible();
    await expect(page.locator(".email-confirmation-footer")).toBeVisible();
    await expect(page.locator(".email-template-copyright")).toBeVisible();
    await expect(page.locator(".email-confirmation .button")).toBeVisible();
    const shellHeight = await page
      .locator(".email-shell")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(shellHeight).toBeGreaterThanOrEqual(1030);
    expect(shellHeight).toBeLessThanOrEqual(1090);
  }
}

for (const source of DESIGN_SOURCES) {
  test(`${source.id} ${source.name} produces a manual visual review pair`, async ({
    page,
  }, testInfo) => {
    const actual = await captureDesign(page, source);
    await verifySampleStructure(page, source.id);
    const actualPath = resolve("output/playwright/design-review", `${source.id}-actual.png`);
    await mkdir(dirname(actualPath), { recursive: true });
    await writeFile(actualPath, actual);

    await testInfo.attach(`${source.id}-reference`, {
      body: await readFile(resolve(source.sourcePath)),
      contentType: "image/png",
    });
    await testInfo.attach(`${source.id}-implementation`, {
      body: actual,
      contentType: "image/png",
    });

    expect(actual.byteLength).toBeGreaterThan(0);
  });
}
