import { describe, expect, it } from "vitest";
import { bytes, createZip } from "../../packages/storage/src/archive/test-zip.js";
import { inspectZip, ZipPolicyError } from "../../packages/storage/src/archive/zip-inspector.js";
import { assertObjectKey, resolveObjectPath } from "../../packages/storage/src/index.js";

describe("archive and storage path boundaries", () => {
  it("accepts only segmented UUID or content-addressed public keys", () => {
    expect(assertObjectKey("aa/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toContain("aa/aa/");
    expect(() => assertObjectKey("../../etc/passwd")).toThrow();
    expect(() => assertObjectKey("aa\\bb\\file")).toThrow();
    expect(() => assertObjectKey(`${"legacy/aa/ff".padEnd(75, "0")}.zip`)).toThrow();
    expect(() => resolveObjectPath("C:/tmp/dls", "../../secret")).toThrow();
  });

  it("rejects traversal, duplicate, and symlink ZIP entries before extraction", async () => {
    for (const name of ["../will.md", "/will.md", "\\\\server\\share\\will.md", "CON/will.md"]) {
      await expect(inspectZip(createZip([{ name, body: bytes("x") }]))).rejects.toBeInstanceOf(
        ZipPolicyError,
      );
    }
    await expect(
      inspectZip(
        createZip([
          { name: "will.md", body: bytes("a") },
          { name: "will.md", body: bytes("b") },
        ]),
      ),
    ).rejects.toThrow(/duplicate|collision/i);
  });
});
