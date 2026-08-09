import { expect, test } from "@playwright/test";
import { selectScenario, stabilizePage } from "./visual-helpers.js";

const PAGES = [
  { name: "setup", route: "/setup", scenario: "admin" },
  { name: "owner-login", route: "/login", scenario: "anonymous" },
  { name: "password-recovery", route: "/password-recovery", scenario: "admin" },
  { name: "contact-login", route: "/contact/login", scenario: "death" },
  { name: "contact-invitation", route: "/contact-invitations", scenario: "death" },
  { name: "contact-password-change", route: "/contact/password-change", scenario: "death" },
  { name: "contact-workflow", route: "/contact/workflows/current", scenario: "death" },
  { name: "private-audit", route: "/admin/audit", scenario: "admin" },
  { name: "system-health", route: "/admin/health", scenario: "admin" },
  { name: "owner-password", route: "/admin/settings/password", scenario: "admin" },
  { name: "email-templates", route: "/admin/settings/email-templates", scenario: "admin" },
  { name: "legal", route: "/legal", scenario: "admin" },
  { name: "privacy", route: "/privacy", scenario: "admin" },
  { name: "forbidden", route: "/403", scenario: "admin" },
  { name: "not-found", route: "/route-that-does-not-exist", scenario: "admin" },
] as const;

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const pageCase of PAGES) {
  for (const viewport of VIEWPORTS) {
    test(`${pageCase.name} ${viewport.name} matches its supplemental baseline`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await selectScenario(page, pageCase.scenario);
      await page.goto(pageCase.route, { waitUntil: "networkidle" });
      await stabilizePage(page);
      await expect(page).toHaveScreenshot(`${pageCase.name}-${viewport.name}.png`, {
        animations: "disabled",
        fullPage: false,
      });
    });
  }
}
