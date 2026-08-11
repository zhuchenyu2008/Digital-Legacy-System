import { expect, test } from "./fixtures/app.js";
import { createSecretCheckedContext } from "./fixtures/assert-no-secrets.js";
import {
  advanceSimulation,
  cancelSimulationOwner,
  createSimulation,
  readSimulation,
  recordSimulationContactDecision,
  resetSimulation,
} from "./fixtures/simulation.js";
import { contactStateFile } from "./stack-state.js";

test("release countdown simulation supports an owner cancellation reset before publication", async ({
  browser,
  cryptoUsers,
  page,
  secrets,
}) => {
  const scenario = await createSimulation(page);
  try {
    await advanceSimulation(page, scenario.id, "CHECKIN_DUE");
    for (const index of [0, 1]) {
      const contactContext = await createSecretCheckedContext(browser, secrets, {
        storageState: contactStateFile(index),
      });
      try {
        const contactPage = await contactContext.newPage();
        await contactPage.goto("/contact/workflows/current", { waitUntil: "networkidle" });
        await recordSimulationContactDecision(contactPage, scenario.id, "DEATH_LIKELY");
      } finally {
        await contactContext.close();
      }
    }
    expect((await readSimulation(page, scenario.id)).synthetic.workflow.state).toBe(
      "RELEASE_PENDING",
    );

    const wrongPassword = "deliberately-wrong-owner-cancel-password";
    secrets.register("wrong-owner-cancel-password", wrongPassword);
    await expect(cancelSimulationOwner(page, scenario.id, wrongPassword)).rejects.toThrow(/401/u);
    const cancelled = await cancelSimulationOwner(page, scenario.id, cryptoUsers.owner.password);
    expect(cancelled.synthetic.workflow).toMatchObject({
      state: "CANCELLED_OWNER",
      disclosureMailSent: true,
    });
  } finally {
    await resetSimulation(page, scenario.id).catch(() => undefined);
  }
});
