import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures/app.js";
import { createSecretCheckedContext } from "./fixtures/assert-no-secrets.js";
import {
  advanceSimulation,
  cancelSimulationOwner,
  createSimulation,
  finalizeSimulationPublication,
  lockSimulationPublication,
  recordSimulationContactDecision,
  resetSimulation,
} from "./fixtures/simulation.js";
import { contactStateFile } from "./stack-state.js";

test("publication simulation reaches the final milestone while formal public state stays isolated", async ({
  browser,
  cryptoUsers,
  page,
  secrets,
}) => {
  const before = await page.evaluate(() =>
    fetch("/api/public/status").then((response) => response.json()),
  );
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

    const advanced = await advanceSimulation(page, scenario.id, "RELEASE_COUNTDOWN");
    expect(advanced.state).toBe("RELEASE_COUNTDOWN");
    await expect(
      cancelSimulationOwner(page, scenario.id, cryptoUsers.owner.password),
    ).rejects.toThrow(/SIMULATION_PUBLISH_LOCKED/u);
    const locked = await lockSimulationPublication(page, scenario.id);
    expect(locked.synthetic.workflow.state).toBe("PUBLISH_LOCKED");
    const published = await finalizeSimulationPublication(page, scenario.id);
    expect(published.synthetic.workflow).toMatchObject({
      state: "PUBLISHED",
      publication: {
        objectKey: `simulations/${scenario.id}/public/legacy.zip`,
      },
    });
    expect(published.synthetic.workflow.publication?.willHtml).toContain("<h1>测试遗嘱</h1>");
    const artifact = await page.evaluate(async (simulationId) => {
      const publicationResponse = await fetch(`/api/owner/simulations/${simulationId}/publication`);
      const publication = await publicationResponse.json();
      const firstResponse = await fetch(
        `/api/owner/simulations/${simulationId}/publication/package`,
        { headers: { range: "bytes=0-63" } },
      );
      const secondResponse = await fetch(
        `/api/owner/simulations/${simulationId}/publication/package`,
        { headers: { range: "bytes=64-" } },
      );
      const first = new Uint8Array(await firstResponse.arrayBuffer());
      const second = new Uint8Array(await secondResponse.arrayBuffer());
      const complete = new Uint8Array(first.length + second.length);
      complete.set(first);
      complete.set(second, first.length);
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", complete))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return {
        publicationStatus: publicationResponse.status,
        publication: publication.data,
        firstStatus: firstResponse.status,
        firstContentRange: firstResponse.headers.get("content-range"),
        secondStatus: secondResponse.status,
        digest,
        bytes: [...complete],
      };
    }, scenario.id);
    expect(artifact.publicationStatus).toBe(200);
    expect(artifact.publication.willHtml).toContain("<h1>测试遗嘱</h1>");
    expect(artifact.publication.willHtml).not.toMatch(/<script|javascript:|onerror=/iu);
    expect(artifact.publication.willHtml).toContain('rel="noopener noreferrer"');
    expect(artifact.firstStatus).toBe(206);
    expect(artifact.secondStatus).toBe(206);
    expect(artifact.firstContentRange).toBe(`bytes 0-63/${artifact.bytes.length}`);
    expect(artifact.digest).toBe(published.synthetic.workflow.publication?.plaintextSha256);
    expect(Buffer.from(artifact.bytes)).toEqual(
      await readFile(fileURLToPath(new URL("./fixtures/test.zip", import.meta.url))),
    );
    const legacy = await page.evaluate(async () => {
      const response = await fetch("/api/public/legacy");
      return { status: response.status, body: await response.text() };
    });
    expect(legacy.status).toBe(404);
    expect(legacy.body).not.toContain("owner-e2e-password-2026");
  } finally {
    await resetSimulation(page, scenario.id).catch(() => undefined);
  }
  const after = await page.evaluate(() =>
    fetch("/api/public/status").then((response) => response.json()),
  );
  expect(after.state).toBe(before.state);
});
