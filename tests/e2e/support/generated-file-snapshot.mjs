import { readFile, writeFile } from "node:fs/promises";

export async function snapshotGeneratedFile(path) {
  const original = await readFile(path);
  return {
    async restore() {
      await writeFile(path, original);
    },
  };
}
