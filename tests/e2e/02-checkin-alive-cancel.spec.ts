import { expect, test } from "./fixtures/app.js";
import { createSecretCheckedContext } from "./fixtures/assert-no-secrets.js";
import {
  advanceSimulation,
  createSimulation,
  readSimulation,
  recordSimulationContactDecision,
  resetSimulation,
} from "./fixtures/simulation.js";
import { contactStateFile } from "./stack-state.js";

test("check-in due simulation can take the alive/cancel path without touching formal state", async ({
  browser,
  page,
  secrets,
}) => {
  const before = await page.evaluate(() =>
    fetch("/api/public/status").then((response) => response.json()),
  );
  const scenario = await createSimulation(page);
  try {
    const advanced = await advanceSimulation(page, scenario.id, "CHECKIN_DUE");
    expect(advanced.state).toBe("CHECKIN_DUE");
    expect(advanced.events.map((event) => event.type)).toContain("CHECKIN_DUE");

    const contactContext = await createSecretCheckedContext(browser, secrets, {
      storageState: contactStateFile(0),
    });
    try {
      const contactPage = await contactContext.newPage();
      await contactPage.goto("/contact/workflows/current", { waitUntil: "networkidle" });
      const cancelled = await recordSimulationContactDecision(contactPage, scenario.id, "ALIVE");
      expect(cancelled.synthetic.workflow).toMatchObject({
        state: "CANCELLED_ALIVE",
        disclosureMailSent: true,
        contactDecisions: [
          {
            contactId: scenario.synthetic.contactIds[0],
            decision: "ALIVE",
          },
        ],
      });
      expect(cancelled.synthetic.workflow.rescheduledCheckinAt).toBe("2026-08-16T00:00:00.000Z");
    } finally {
      await contactContext.close();
    }

    expect((await readSimulation(page, scenario.id)).synthetic.workflow.state).toBe(
      "CANCELLED_ALIVE",
    );
  } finally {
    await resetSimulation(page, scenario.id).catch(() => undefined);
  }
  const after = await page.evaluate(() =>
    fetch("/api/public/status").then((response) => response.json()),
  );
  expect(after.state).toBe(before.state);
});
