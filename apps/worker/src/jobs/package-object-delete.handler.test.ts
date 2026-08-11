import { describe, expect, test, vi } from "vitest";
import { PackageObjectDeleteHandler } from "./package-object-delete.handler";

describe("PackageObjectDeleteHandler", () => {
  test("deletes only a superseded package object from the private namespace", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const handler = new PackageObjectDeleteHandler(
      async () => ({
        status: "SUPERSEDED",
        objectKey: "vault/old-package",
        activeObjectKey: "vault/current-package",
      }),
      { delete: remove },
    );

    await handler.handle({
      id: "job-1",
      name: "package.object-delete",
      data: { aggregateId: "old-package", aggregateVersion: 0 },
    });

    expect(remove).toHaveBeenCalledWith("private", "vault/old-package");
  });

  test("deletes aborted staging objects but refuses to touch the active object", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const aborted = new PackageObjectDeleteHandler(
      async () => ({
        status: "ABORTED",
        objectKey: "vault/aborted-package",
        activeObjectKey: "vault/current-package",
      }),
      { delete: remove },
    );
    await aborted.handle({
      id: "job-2",
      name: "package.object-delete",
      data: { aggregateId: "aborted-package", aggregateVersion: 0 },
    });
    expect(remove).toHaveBeenCalledWith("staging", "vault/aborted-package");

    const active = new PackageObjectDeleteHandler(
      async () => ({
        status: "ACTIVE",
        objectKey: "vault/current-package",
        activeObjectKey: "vault/current-package",
      }),
      { delete: remove },
    );
    await expect(
      active.handle({
        id: "job-3",
        name: "package.object-delete",
        data: { aggregateId: "current-package", aggregateVersion: 0 },
      }),
    ).rejects.toThrow("active package object");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
