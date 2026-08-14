import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type ComposeService = {
  profiles?: string[];
  ports?: Array<string | { published?: string | number }>;
  healthcheck?: unknown;
  read_only?: boolean;
  command?: string | string[];
  environment?: Record<string, string | null> | string[];
  image?: string;
  secrets?: Array<string | { source?: string }>;
  tmpfs?: string[];
};

type ComposeConfig = {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
};

function composeConfig(profiles: string[] = []): ComposeConfig {
  const args = [
    "compose",
    ...profiles.flatMap((profile) => ["--profile", profile]),
    "config",
    "--format",
    "json",
  ];
  return JSON.parse(
    execFileSync("docker", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: { ...process.env, DOCKER_CONFIG: resolve(workspaceRoot, ".docker-config") },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ) as ComposeConfig;
}

function publishedPorts(service: ComposeService): number {
  return service.ports?.length ?? 0;
}

describe("Docker Compose topology", () => {
  test("pins the Dockerfile frontend image by digest", () => {
    const dockerfile = readFileSync(resolve(workspaceRoot, "Dockerfile"), "utf8");
    expect(dockerfile.split(/\r?\n/, 1)[0]).toMatch(
      /^# syntax=docker\/dockerfile:1\.7@sha256:[a-f0-9]{64}$/,
    );
  });

  test("defines the default services and isolates optional S3 services", () => {
    const config = composeConfig();
    expect(Object.keys(config.services).sort()).toEqual([
      "api",
      "caddy",
      "mailpit",
      "postgres",
      "web",
      "worker",
    ]);

    const s3 = composeConfig(["s3"]);
    expect(s3.services.minio?.profiles).toEqual(["s3"]);
    expect(s3.services["minio-init"]?.profiles).toEqual(["s3"]);
  });

  test("activates Linux acceptance without pulling in S3-only services", () => {
    const services = composeConfig(["test"]).services;
    expect(services.acceptance?.profiles).toEqual(["test"]);
    expect(services.acceptance?.environment).toMatchObject({
      COREPACK_HOME: "/tmp/corepack",
      NODE_ENV: "test",
      RUNNING_IN_CONTAINER: "false",
    });
    const acceptanceTmpfs = services.acceptance?.tmpfs ?? [];
    for (const projectRoot of [
      "apps/api",
      "apps/web",
      "apps/worker",
      "packages/contracts",
      "packages/crypto",
      "packages/domain",
      "packages/email-templates",
      "packages/persistence",
      "packages/storage",
      "packages/vss-wasm",
    ]) {
      expect(
        acceptanceTmpfs.some((entry) =>
          entry.startsWith(`/workspace/${projectRoot}/node_modules/.vite-temp:`),
        ),
      ).toBe(true);
    }
    expect(services["storage-tests"]).toBeUndefined();
    expect(services.minio).toBeUndefined();
    expect(services["minio-init"]).toBeUndefined();
  });

  test("provides a least-privilege migration job without starting it by default", () => {
    const migrator = composeConfig(["ops"]).services.migrator;
    expect(migrator?.profiles).toEqual(expect.arrayContaining(["ops", "test"]));
    expect(migrator?.read_only).toBe(true);
    expect(publishedPorts(migrator ?? {})).toBe(0);
    expect(
      migrator?.secrets?.some((secret) =>
        typeof secret === "string"
          ? secret === "migrator_db_password"
          : secret.source === "migrator_db_password",
      ),
    ).toBe(true);
    const command = Array.isArray(migrator?.command)
      ? migrator.command.join("\n")
      : (migrator?.command ?? "");
    const pgBossMigration = command.indexOf("pg-boss/dist/cli.js migrate");
    const applicationMigration = command.indexOf("runMigrationCli");
    expect(command).toContain("PGBOSS_DATABASE_URL");
    expect(pgBossMigration).toBeGreaterThan(-1);
    expect(applicationMigration).toBeGreaterThan(pgBossMigration);

    const roleBootstrap = readFileSync(
      resolve(workspaceRoot, "ops/postgres/init/001-roles.sh"),
      "utf8",
    );
    expect(roleBootstrap).not.toContain("\r");
    expect(roleBootstrap).toContain("GRANT CREATE ON DATABASE dls TO dls_migrator;");
  });

  test("defines durable database and object volumes", () => {
    expect(Object.keys(composeConfig().volumes ?? {}).sort()).toEqual(
      expect.arrayContaining([
        "postgres_data",
        "private_objects",
        "public_objects",
        "staging_objects",
      ]),
    );
  });

  test("publishes application HTTP only through Caddy", () => {
    const services = composeConfig().services;
    expect(publishedPorts(services.caddy ?? {})).toBeGreaterThan(0);
    for (const [name, service] of Object.entries(services)) {
      if (name !== "caddy") {
        expect(publishedPorts(service), `${name} must not publish a host port`).toBe(0);
      }
    }
  });

  test("adds health checks and least-privilege filesystems", () => {
    const services = composeConfig(["s3"]).services;
    for (const service of ["postgres", "mailpit", "minio"]) {
      expect(services[service]?.healthcheck, `${service} needs a healthcheck`).toBeDefined();
    }
    for (const service of ["api", "worker", "web", "caddy"] as const) {
      expect(
        services[service]?.read_only,
        `${service} should use a read-only root filesystem`,
      ).toBe(true);
    }
  });

  test("uses immutable images and contains no hard-coded production secrets", () => {
    const services = composeConfig(["s3"]).services;
    for (const [name, service] of Object.entries(services)) {
      if (service.image) {
        expect(service.image, `${name} image must include a sha256 digest`).toMatch(
          /@sha256:[a-f0-9]{64}$/,
        );
      }
      expect(
        JSON.stringify(service.environment ?? {}),
        `${name} contains a production secret`,
      ).not.toMatch(/(?:PASSWORD|SECRET|TOKEN|ACCESS_KEY)"?\s*[:=]\s*"?(?!\$\{|\/run\/secrets\/)/i);
    }
  });

  test("mounts purpose-separated key capabilities into only the owning process", () => {
    const services = composeConfig().services;
    const names = (service: ComposeService | undefined) =>
      new Set(
        (service?.secrets ?? []).map((secret) =>
          typeof secret === "string" ? secret : String(secret.source),
        ),
      );
    const api = names(services.api);
    for (const capability of [
      "release_ingress_public_key",
      "recovery_ingress_public_key",
      "recovery_ingress_private_key",
      "recovery_stage_kek",
    ]) {
      expect(api).toContain(capability);
    }
    expect(api).not.toContain("release_ingress_private_key");
    expect(api).not.toContain("release_stage_kek");

    const worker = names(services.worker);
    for (const capability of [
      "release_ingress_public_key",
      "release_ingress_private_key",
      "release_stage_kek",
    ]) {
      expect(worker).toContain(capability);
    }
    expect(worker).not.toContain("recovery_ingress_private_key");
    expect(worker).not.toContain("recovery_stage_kek");
  });
});
