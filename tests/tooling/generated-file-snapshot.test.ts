import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotGeneratedFile } from "../e2e/support/generated-file-snapshot.mjs";

describe("generated file snapshot", () => {
  it("restores the exact original bytes after a development server rewrites the file", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "dls-generated-file-"));
    const path = resolve(directory, "next-env.d.ts");
    const original = Buffer.from("original\r\nbytes\r\n", "utf8");
    await writeFile(path, original);

    const snapshot = await snapshotGeneratedFile(path);
    await writeFile(path, "rewritten\nby next dev\n", "utf8");
    await snapshot.restore();

    expect(await readFile(path)).toEqual(original);
  });
});
