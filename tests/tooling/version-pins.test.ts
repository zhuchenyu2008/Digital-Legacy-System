import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type PackageManifest = {
  packageManager?: string;
  engines?: { node?: string };
  [key: string]: unknown;
};

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "overrides",
] as const;

function packageJsonPaths(): string[] {
  const paths = [join(workspaceRoot, "package.json")];

  for (const workspaceDirectory of ["apps", "packages"]) {
    const directory = join(workspaceRoot, workspaceDirectory);
    if (!existsSync(directory)) {
      continue;
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = join(directory, entry.name, "package.json");
      if (existsSync(manifestPath)) {
        paths.push(manifestPath);
      }
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

function isPinnedDependencySpecifier(value: string): boolean {
  if (value === "workspace:*") {
    return true;
  }

  return /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}

function workspaceOverrideValues(): string[] {
  const workspaceFile = readFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");
  const lines = workspaceFile.split(/\r?\n/);
  const values: string[] = [];
  let inOverrides = false;

  for (const line of lines) {
    if (/^overrides:\s*$/.test(line)) {
      inOverrides = true;
      continue;
    }

    if (inOverrides && /^\S/.test(line)) {
      break;
    }

    if (!inOverrides || /^\s*(?:#|$)/.test(line)) {
      continue;
    }

    const match = line.match(/^\s{2}[^:]+:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
    if (!match) {
      throw new Error(`Cannot parse pnpm override line: ${line}`);
    }

    values.push(match[1] ?? match[2] ?? match[3]);
  }

  return values;
}

describe("workspace version pins", () => {
  test.each([
    "latest",
    "1.x",
    "1.2.x",
    "1.0.0 - 2.0.0",
    "^1.2.3",
    "~1.2.3",
    ">=1.2.3",
    "npm:example@latest",
    "workspace:^",
    "workspace:~",
  ])("rejects floating dependency specifier %s", (specifier) => {
    expect(isPinnedDependencySpecifier(specifier)).toBe(false);
  });

  test.each(["1.2.3", "1.2.3-beta.1", "workspace:*"])(
    "accepts pinned dependency specifier %s",
    (specifier) => {
      expect(isPinnedDependencySpecifier(specifier)).toBe(true);
    },
  );

  test("pins every workspace manifest and dependency range", () => {
    const manifests = packageJsonPaths();
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
          isPinnedDependencySpecifier(value),
          `${manifestPath} contains an unpinned dependency: ${value}`,
        ).toBe(true);
      }
    }

    for (const value of workspaceOverrideValues()) {
      expect(
        isPinnedDependencySpecifier(value),
        `pnpm-workspace.yaml contains an unpinned override: ${value}`,
      ).toBe(true);
    }

    expect(readFileSync(join(workspaceRoot, ".node-version"), "utf8").trim()).toBe("24.18.0");
  });
});
