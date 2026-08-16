import { readFile, writeFile } from "node:fs/promises";

export async function snapshotGeneratedFile(path) {
  const original = await readFile(path);
  return {
    async restore() {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await writeFile(path, original);
          return;
        } catch (error) {
          const code = error?.code;
          const transientWindowsLock =
            process.platform === "win32" && ["EBUSY", "EPERM", "UNKNOWN"].includes(code);
          if (!transientWindowsLock || attempt >= 20) throw error;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 100 * (attempt + 1)));
        }
      }
    },
  };
}
