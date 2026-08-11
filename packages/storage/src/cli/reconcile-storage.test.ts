import { describe, expect, it, vi } from "vitest";
import { reconcileStorageReferences } from "./reconcile-storage.js";

describe("storage reference reconciliation", () => {
  it("checks database package/publication references in their exact namespaces", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "package-1",
            status: "ACTIVE",
            object_key: "aa/item",
            bytes: 5,
            sha256: "a".repeat(64),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "publication-1",
            object_key: "legacy/item.zip",
            bytes: 7,
            sha256: "b".repeat(64),
          },
        ],
      });
    const head = vi
      .fn()
      .mockResolvedValueOnce({ bytes: 5, sha256: "a".repeat(64), etag: "private" })
      .mockResolvedValueOnce({ bytes: 7, sha256: "b".repeat(64), etag: "public" });

    await expect(
      reconcileStorageReferences({ query } as never, { head } as never),
    ).resolves.toEqual({ packages: 1, publications: 1 });
    expect(head).toHaveBeenNthCalledWith(1, "private", "aa/item");
    expect(head).toHaveBeenNthCalledWith(2, "public", "legacy/item.zip");
  });

  it("fails closed on a missing referenced object", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "package-1",
            status: "READY",
            object_key: "aa/item",
            bytes: 5,
            sha256: "a".repeat(64),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      reconcileStorageReferences(
        { query } as never,
        { head: vi.fn().mockResolvedValue(null) } as never,
      ),
    ).rejects.toThrow(/missing|inconsistent/iu);
  });
});
