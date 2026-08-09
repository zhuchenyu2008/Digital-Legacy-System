import { readE2EState } from "../stack-state.js";
import { expect, test } from "./app.js";

test("starts one blank isolated Compose stack with only Mailpit SMTP", async ({ app, request }) => {
  const state = await readE2EState();

  expect(state.projectName).toMatch(/^dls-e2e-[a-z0-9-]+$/u);
  expect(state.services).toEqual(["api", "caddy", "mailpit", "postgres", "web", "worker"]);
  expect(state.formalRows).toBe(0);
  expect(state.simulationRows).toBe(0);
  expect(state.mailTransport).toBe("smtp://mailpit:1025");

  const readiness = await request.get("/health/ready");
  expect(readiness.ok()).toBe(true);
  expect(await readiness.json()).toMatchObject({ status: "ok", service: "api" });

  await app.open("/setup");
  await expect(app.page.locator("main")).toBeVisible();

  const mailpit = await request.get(state.mailpitUrl);
  expect(mailpit.ok()).toBe(true);
});
