import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type PackageManifest = {
  packageManager?: string;
  engines?: { node?: string };
  [key: string]: unknown;
};

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const forbiddenDependencyPrefixes = ["^", "~", ">", "<", "*", "workspace:^", "workspace:~"];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
] as const;

function packageJsonPaths(directory: string): string[] {
  const paths: string[] = [];

  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    const stats = statSync(entryPath);

    if (stats.isDirectory() && ![".git", "node_modules", ".worktrees"].includes(entry)) {
      paths.push(...packageJsonPaths(entryPath));
    } else if (stats.isFile() && entry === "package.json") {
      paths.push(entryPath);
    }
  }

  return paths;
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function dependencyValues(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value as Record<string, unknown>).flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }

    return dependencyValues(entry);
  });
}

describe("workspace version pins", () => {
  test("pins every workspace manifest and dependency range", () => {
    const manifests = packageJsonPaths(workspaceRoot);
    expect(manifests.length).toBeGreaterThan(0);

    const rootManifestPath = join(workspaceRoot, "package.json");
    expect(manifests).toContain(rootManifestPath);

    const rootManifest = readManifest(rootManifestPath);
    expect(rootManifest.packageManager).toBe("pnpm@11.20.0");
    expect(rootManifest.engines?.node).toBe("24.18.0");

    for (const manifestPath of manifests) {
      const manifest = readManifest(manifestPath);
      const pnpm = manifest.pnpm as { overrides?: unknown } | undefined;
      const values = [
        ...dependencySections.flatMap((section) => dependencyValues(manifest[section])),
        ...dependencyValues(pnpm?.overrides),
      ];

      for (const value of values) {
        expect(
          forbiddenDependencyPrefixes.some((prefix) => value.startsWith(prefix)),
          `${manifestPath} contains an unpinned dependency range: ${value}`,
        ).toBe(false);
      }
    }

    expect(readFileSync(join(workspaceRoot, ".node-version"), "utf8").trim()).toBe("24.18.0");
  });
});
