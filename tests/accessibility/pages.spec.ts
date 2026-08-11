import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { selectScenario } from "../visual/visual-helpers.js";

const ROUTES = [
  { name: "public-normal", route: "/", scenario: "admin" },
  { name: "public-confirming", route: "/", scenario: "death" },
  { name: "legacy", route: "/legacy", scenario: "legacy" },
  { name: "setup", route: "/setup", scenario: "admin" },
  { name: "owner-login", route: "/login", scenario: "anonymous" },
  { name: "password-recovery", route: "/password-recovery", scenario: "admin" },
  { name: "admin-home", route: "/admin", scenario: "admin" },
  { name: "contacts", route: "/admin/contacts", scenario: "admin" },
  { name: "files", route: "/admin/files", scenario: "admin" },
  { name: "settings", route: "/admin/settings", scenario: "admin" },
  { name: "owner-workflow", route: "/admin/workflows/current", scenario: "release" },
  { name: "audit", route: "/admin/audit", scenario: "admin" },
  { name: "health", route: "/admin/health", scenario: "admin" },
  { name: "owner-password", route: "/admin/settings/password", scenario: "admin" },
  { name: "email-templates", route: "/admin/settings/email-templates", scenario: "admin" },
  { name: "contact-login", route: "/contact/login", scenario: "death" },
  { name: "contact-invitation", route: "/contact-invitations", scenario: "death" },
  { name: "contact-password", route: "/contact/password-change", scenario: "death" },
  { name: "contact-workflow", route: "/contact/workflows/current", scenario: "death" },
  { name: "legal", route: "/legal", scenario: "admin" },
  { name: "privacy", route: "/privacy", scenario: "admin" },
  { name: "forbidden", route: "/403", scenario: "admin" },
] as const;

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    test(`${route.name} ${viewport.name} has no serious accessibility violations`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await selectScenario(page, route.scenario);
      await page.goto(route.route, { waitUntil: "networkidle" });
      const results = await new AxeBuilder({ page }).analyze();
      const severe = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );
      expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }
}

test("mobile controls meet touch target sizing on operational pages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/admin", "/admin/contacts", "/admin/files", "/admin/settings"]) {
    await selectScenario(page, "admin");
    await page.goto(route, { waitUntil: "networkidle" });
    const undersized = await page
      .locator(".dls-button, input, select, textarea, .dls-mobile-nav a")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label:
                element.getAttribute("aria-label") ??
                element.textContent?.trim() ??
                element.tagName,
              width: rect.width,
              height: rect.height,
            };
          })
          .filter((target) => target.width < 44 || target.height < 44),
      );
    expect(undersized, `${route}: ${JSON.stringify(undersized)}`).toEqual([]);
  }
});

test("key pages reflow without horizontal scrolling at a 200 percent zoom equivalent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  for (const item of [
    { route: "/admin/contacts", scenario: "admin" },
    { route: "/admin/files", scenario: "admin" },
    { route: "/admin/settings", scenario: "admin" },
    { route: "/", scenario: "death" },
    { route: "/legacy", scenario: "legacy" },
  ] as const) {
    await selectScenario(page, item.scenario);
    await page.goto(item.route, { waitUntil: "networkidle" });
    const reflow = await page.evaluate(() => {
      const clientWidth = document.documentElement.clientWidth;
      const overflow = document.documentElement.scrollWidth - clientWidth;
      const offenders = [...document.querySelectorAll("*")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
              element.classList.length > 0 ? `.${[...element.classList].join(".")}` : ""
            }`,
            clientWidth: element.clientWidth,
            left: Math.round(rect.left),
            overflowX: style.overflowX,
            right: Math.round(rect.right),
            scrollWidth: element.scrollWidth,
            width: Math.round(rect.width),
          };
        })
        .filter(
          (element) =>
            element.left < -1 ||
            element.right > clientWidth + 1 ||
            (element.scrollWidth > element.clientWidth + 1 && element.overflowX === "visible"),
        )
        .slice(0, 12);
      return { offenders, overflow };
    });
    expect(
      reflow.overflow,
      `${item.route}: ${JSON.stringify(reflow.offenders)}`,
    ).toBeLessThanOrEqual(1);
  }
});

test("keyboard focus is visible and reduced motion removes decorative animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await selectScenario(page, "admin");
  await page.goto("/admin", { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  const animated = await page.evaluate(
    () =>
      [...document.querySelectorAll("*")].filter((element) =>
        [null, "::before", "::after"].some((pseudo) => {
          const style = getComputedStyle(element, pseudo);
          return style.animationName !== "none" && style.animationDuration !== "0s";
        }),
      ).length,
  );
  expect(animated).toBe(0);
});
