import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/app.js";
import { queryPostgres, restartStatefulServices, workerObjectExists } from "./fixtures/compose.js";
import { readE2EState } from "./stack-state.js";

type PackageView = Readonly<{ id: string; versionNo: number; status: string }>;
type StoredPackage = Readonly<{
  id: string;
  versionNo: number;
  status: string;
  objectKey: string;
}>;

async function packages(page: Page): Promise<readonly PackageView[]> {
  return page.evaluate(async () => {
    const response = await fetch("/api/owner/packages");
    if (!response.ok) throw new Error(`package list failed with ${response.status}`);
    return (await response.json()) as readonly PackageView[];
  });
}

async function storedPackages(state: Awaited<ReturnType<typeof readE2EState>>) {
  const lines = await queryPostgres(
    state,
    "SELECT concat_ws('|', id::text, version_no::text, status, object_key) FROM app.legacy_packages ORDER BY version_no",
  );
  return lines.map((line): StoredPackage => {
    const [id, version, status, objectKey] = line.split("|");
    if (id === undefined || status === undefined || objectKey === undefined) {
      throw new Error(`invalid package row: ${line}`);
    }
    const versionNo = Number(version);
    if (!Number.isSafeInteger(versionNo)) throw new Error(`invalid package version: ${line}`);
    return { id, versionNo, status, objectKey };
  });
}

async function waitForDeletedObject(
  state: Awaited<ReturnType<typeof readE2EState>>,
  namespace: "private" | "staging",
  objectKey: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  do {
    if (!(await workerObjectExists(state, namespace, objectKey))) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error(`${namespace}/${objectKey} was not deleted by the worker`);
}

test("aborts one upload, resumes the same session across service restarts, and preserves the new object", async ({
  app,
  cryptoUsers,
}) => {
  const state = await readE2EState();
  const archivePath = fileURLToPath(new URL("./fixtures/test.zip", import.meta.url));

  let releaseHeldPut!: () => void;
  let observeHeldPut!: () => void;
  const heldPut = new Promise<void>((resolve) => {
    observeHeldPut = resolve;
  });
  const releasePut = new Promise<void>((resolve) => {
    releaseHeldPut = resolve;
  });
  await app.page.route("**/api/owner/packages/*/content", async (route) => {
    observeHeldPut();
    await releasePut;
    await route.abort("aborted");
  });
  await app.open("/admin/files");
  await app.page.locator("#package-owner-password").fill(cryptoUsers.owner.recoveryPassword);
  await app.page.locator("#vault-package").setInputFiles(archivePath);
  await heldPut;
  const abortResponsePromise = app.page.waitForResponse(
    (response) =>
      /\/api\/owner\/packages\/[^/]+\/abort$/u.test(response.url()) &&
      response.request().method() === "POST",
  );
  await app.page.getByRole("button", { name: "中止" }).click();
  const abortResponse = await abortResponsePromise;
  expect(abortResponse.status()).toBe(200);
  const abortRequest = abortResponse.request();
  const replayAbortStatus = await app.page.evaluate(
    async ({ path, idempotencyKey, uploadId }) => {
      const csrf = document.cookie
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith("dls-owner-csrf="))
        ?.slice("dls-owner-csrf=".length);
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "x-csrf-token": decodeURIComponent(csrf ?? ""),
          "idempotency-key": idempotencyKey,
          "x-upload-id": uploadId,
        },
      });
      return response.status;
    },
    {
      path: new URL(abortResponse.url()).pathname,
      idempotencyKey: abortRequest.headers()["idempotency-key"] ?? "",
      uploadId: abortRequest.headers()["x-upload-id"] ?? "",
    },
  );
  expect(replayAbortStatus).toBe(200);
  releaseHeldPut();
  await expect(app.page.locator(".dls-toast")).toContainText("上传已中止");
  await app.page.unroute("**/api/owner/packages/*/content");

  const afterAbort = await packages(app.page);
  const aborted = afterAbort.find((item) => item.status === "ABORTED");
  expect(aborted).toBeDefined();

  let attempts = 0;
  const uploadIdentities: Array<Readonly<{ uploadId?: string; idempotencyKey?: string }>> = [];
  await app.page.route("**/api/owner/packages/*/content", async (route) => {
    attempts += 1;
    const headers = route.request().headers();
    uploadIdentities.push({
      uploadId: headers["x-upload-id"],
      idempotencyKey: headers["idempotency-key"],
    });
    if (attempts === 1) {
      await restartStatefulServices(state);
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await app.open("/admin/files");
  await app.page.locator("#package-owner-password").fill(cryptoUsers.owner.recoveryPassword);
  await app.page.locator("#vault-package").setInputFiles(archivePath);
  await expect(app.page.locator(".dls-toast")).toContainText("已激活", { timeout: 180_000 });
  await app.page.unroute("**/api/owner/packages/*/content");

  expect(attempts).toBe(2);
  expect(uploadIdentities[0]?.uploadId).toBeTruthy();
  expect(uploadIdentities[1]).toEqual(uploadIdentities[0]);
  const currentPackages = await packages(app.page);
  expect(currentPackages.filter((item) => item.status === "ACTIVE")).toHaveLength(1);
  expect(currentPackages.some((item) => item.status === "SUPERSEDED")).toBe(true);

  const stored = await storedPackages(state);
  const active = stored.find((item) => item.status === "ACTIVE");
  const superseded = stored.filter((item) => item.status === "SUPERSEDED");
  const abortedRow = stored.find((item) => item.id === aborted?.id);
  expect(active).toBeDefined();
  expect(superseded.length).toBeGreaterThanOrEqual(1);
  expect(abortedRow?.status).toBe("ABORTED");
  if (active === undefined || abortedRow === undefined) {
    throw new Error("active or aborted package storage metadata is unavailable");
  }

  for (const oldPackage of superseded) {
    await waitForDeletedObject(state, "private", oldPackage.objectKey);
  }
  await waitForDeletedObject(state, "staging", abortedRow.objectKey);
  expect(await workerObjectExists(state, "private", active.objectKey)).toBe(true);
});
