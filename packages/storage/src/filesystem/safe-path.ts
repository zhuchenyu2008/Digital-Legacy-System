import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { assertObjectKey } from "../object-key.js";

type FileStats = Readonly<{
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}>;

function isSymlinkOrReparsePoint(stats: FileStats): boolean {
  return stats.isSymbolicLink();
}

export function assertAbsoluteRoot(root: string): string {
  if (typeof root !== "string" || !isAbsolute(root)) {
    throw new Error("Storage roots must be absolute paths");
  }
  return resolve(root);
}

export function resolveObjectPath(root: string, key: string): string {
  const safeRoot = assertAbsoluteRoot(root);
  assertObjectKey(key);
  const target = resolve(safeRoot, ...key.split("/"));
  const relative = target.slice(safeRoot.length);
  if (!relative.startsWith("\\") && !relative.startsWith("/")) {
    throw new Error("Object key escapes the configured root");
  }
  return target;
}

export async function ensureSafeRoot(root: string): Promise<string> {
  const safeRoot = assertAbsoluteRoot(root);
  await mkdir(safeRoot, { recursive: true, mode: 0o700 });
  const stats = (await lstat(safeRoot)) as FileStats;
  if (!stats.isDirectory() || isSymlinkOrReparsePoint(stats)) {
    throw new Error("Storage root must be a real directory");
  }
  return safeRoot;
}

export async function assertNoSymlinkEscape(root: string, key: string): Promise<void> {
  const safeRoot = await ensureSafeRoot(root);
  const target = resolveObjectPath(safeRoot, key);
  const segments = key.split("/");
  let current = safeRoot;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) throw new Error("Invalid object key segment");
    current = join(current, segment);
    try {
      const stats = (await lstat(current)) as FileStats;
      if (isSymlinkOrReparsePoint(stats))
        throw new Error("Object path contains a symlink or reparse point");
      if (index < segments.length - 1 && !stats.isDirectory()) {
        throw new Error("Object path parent is not a directory");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  if (!target.startsWith(safeRoot)) throw new Error("Object path escapes the configured root");
}
