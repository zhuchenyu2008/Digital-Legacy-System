import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures/app.js";
import {
  createSecretCheckedContext,
  type SecretLeakDetector,
} from "./fixtures/assert-no-secrets.js";
import {
  advanceSimulation,
  cancelSimulationOwner,
  createSimulation,
  finalizeSimulationPublication,
  lockSimulationPublication,
  recordSimulationContactDecision,
  resetSimulation,
  type SimulationScenario,
} from "./fixtures/simulation.js";
import { contactStateFile } from "./stack-state.js";

async function decide(
  browser: Browser,
  secrets: SecretLeakDetector,
  scenario: SimulationScenario,
  index: number,
  decision: "ALIVE" | "DEATH_LIKELY",
): Promise<void> {
  const context = await createSecretCheckedContext(browser, secrets, {
    storageState: contactStateFile(index),
  });
  try {
    const page = await context.newPage();
    await page.goto("/contact/workflows/current", { waitUntil: "networkidle" });
    await recordSimulationContactDecision(page, scenario.id, decision);
  } finally {
    await context.close();
  }
}

async function publishScenario(
  browser: Browser,
  secrets: SecretLeakDetector,
  page: Page,
): Promise<void> {
  const scenario = await createSimulation(page);
  try {
    await advanceSimulation(page, scenario.id, "CHECKIN_DUE");
    await decide(browser, secrets, scenario, 0, "DEATH_LIKELY");
    await decide(browser, secrets, scenario, 1, "DEATH_LIKELY");
    await advanceSimulation(page, scenario.id, "RELEASE_COUNTDOWN");
    await lockSimulationPublication(page, scenario.id);
    await finalizeSimulationPublication(page, scenario.id);
    const artifact = await page.evaluate(async (simulationId) => {
      const publication = await fetch(`/api/owner/simulations/${simulationId}/publication`);
      const download = await fetch(`/api/owner/simulations/${simulationId}/publication/package`, {
        headers: { range: "bytes=0-15" },
      });
      return {
        publicationStatus: publication.status,
        publicationBody: await publication.text(),
        downloadStatus: download.status,
        contentRange: download.headers.get("content-range"),
        bytes: [...new Uint8Array(await download.arrayBuffer())],
      };
    }, scenario.id);
    expect(artifact.publicationStatus).toBe(200);
    expect(artifact.publicationBody).toContain("测试遗嘱");
    expect(artifact.publicationBody).not.toContain("<script");
    expect(artifact.downloadStatus).toBe(206);
    expect(artifact.contentRange).toMatch(/^bytes 0-15\/\d+$/u);
    expect(Buffer.from(artifact.bytes).subarray(0, 2).toString("utf8")).toBe("PK");
  } finally {
    await resetSimulation(page, scenario.id).catch(() => undefined);
  }
}

test("runs login, critical decisions, public rendering, and download in supported browsers", async ({
  app,
  browser,
  cryptoUsers,
  secrets,
}, testInfo) => {
  const loginContext = await createSecretCheckedContext(browser, secrets);
  try {
    const page = await loginContext.newPage();
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.locator("#owner-password").fill(cryptoUsers.owner.recoveryPassword);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/owner/login") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "管理员登录" }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin(?:\/|$)/u);
    await page.goto("/legacy", { waitUntil: "networkidle" });
    await expect(page.locator("main")).toBeVisible();
  } finally {
    await loginContext.close();
  }

  await app.open("/admin");
  await expect(app.page.locator("body")).not.toContainText("Internal Server Error");

  if (testInfo.project.name === "mobile-chromium") {
    const alive = await createSimulation(app.page);
    try {
      await advanceSimulation(app.page, alive.id, "CHECKIN_DUE");
      await decide(browser, secrets, alive, 0, "ALIVE");
    } finally {
      await resetSimulation(app.page, alive.id).catch(() => undefined);
    }

    const cancelled = await createSimulation(app.page);
    try {
      await advanceSimulation(app.page, cancelled.id, "CHECKIN_DUE");
      await decide(browser, secrets, cancelled, 0, "DEATH_LIKELY");
      await decide(browser, secrets, cancelled, 1, "DEATH_LIKELY");
      expect(
        (await cancelSimulationOwner(app.page, cancelled.id, cryptoUsers.owner.recoveryPassword))
          .synthetic.workflow.state,
      ).toBe("CANCELLED_OWNER");
    } finally {
      await resetSimulation(app.page, cancelled.id).catch(() => undefined);
    }
  }

  await publishScenario(browser, secrets, app.page);
});
