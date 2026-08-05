import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const allowed = {
  domain: [],
  application: ["domain", "contracts"],
  contracts: [],
  crypto: ["domain", "contracts"],
  persistence: ["application", "domain", "contracts"],
  storage: ["application", "domain"],
  "email-templates": ["application", "contracts"],
  "test-fixtures": ["application", "domain", "contracts"],
} as const;

const appNames = ["api", "worker", "web"] as const;

type PackageManifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function TypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return TypeScriptFiles(path);
    }

    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) ? [path] : [];
  });
}

function importSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  source.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
  });

  return imports;
}

function containsProcessEnv(path: string): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process"
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return found;
}

describe("package dependency boundaries", () => {
  test("defines every planned app and package manifest", () => {
    for (const app of appNames) {
      expect(
        existsSync(join(workspaceRoot, "apps", app, "package.json")),
        `missing app ${app}`,
      ).toBe(true);
    }

    for (const packageName of Object.keys(allowed)) {
      expect(
        existsSync(join(workspaceRoot, "packages", packageName, "package.json")),
        `missing package ${packageName}`,
      ).toBe(true);
    }
  });

  test("keeps internal package dependencies pointing inward", () => {
    for (const [packageName, allowedDependencies] of Object.entries(allowed)) {
      const manifestPath = join(workspaceRoot, "packages", packageName, "package.json");
      expect(existsSync(manifestPath), `missing ${manifestPath}`).toBe(true);
      const manifest = readJson<PackageManifest>(manifestPath);
      expect(manifest.name).toBe(`@dls/${packageName}`);

      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
      for (const [dependency, version] of Object.entries(dependencies)) {
        if (!dependency.startsWith("@dls/")) {
          continue;
        }

        const dependencyName = dependency.slice("@dls/".length);
        expect(allowedDependencies, `${packageName} cannot depend on ${dependencyName}`).toContain(
          dependencyName,
        );
        expect(version).toBe("workspace:*");
      }
    }
  });

  test("rejects private source imports across packages", () => {
    for (const sourceRoot of [join(workspaceRoot, "apps"), join(workspaceRoot, "packages")]) {
      for (const path of TypeScriptFiles(sourceRoot)) {
        for (const specifier of importSpecifiers(path)) {
          expect(
            specifier,
            `${relative(workspaceRoot, path)} imports a private package source`,
          ).not.toMatch(/^@dls\/[^/]+\/src(?:\/|$)/);
        }
      }
    }
  });

  test("restricts process.env reads to app config roots", () => {
    for (const path of TypeScriptFiles(join(workspaceRoot, "apps"))) {
      if (!containsProcessEnv(path)) {
        continue;
      }

      const relativePath = relative(workspaceRoot, path).replaceAll("\\", "/");
      expect(relativePath).toMatch(/^apps\/[^/]+\/src\/config\//);
    }

    for (const path of TypeScriptFiles(join(workspaceRoot, "packages"))) {
      expect(containsProcessEnv(path), `${relative(workspaceRoot, path)} reads process.env`).toBe(
        false,
      );
    }
  });
});
