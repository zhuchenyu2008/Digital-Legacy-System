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
  environment?: Record<string, string | null> | string[];
  image?: string;
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
});
