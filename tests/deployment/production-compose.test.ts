import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("production Compose topology", () => {
  it("defines a least-privilege TLS edge and private application network", async () => {
    const compose = await readFile(resolve(root, "compose.prod.yaml"), "utf8");
    expect(compose).toContain("caddy:");
    expect(compose).toContain('published: "80"');
    expect(compose).toContain('published: "443"');
    expect(compose).not.toContain("smtp://mailpit");
    expect(compose).toMatch(/mailpit:\s*\n\s*profiles:\s*\[disabled\]/u);
    expect(compose).toMatch(/minio:\s*\n\s*profiles:\s*\[disabled\]/u);
    expect(compose).toMatch(/read_only:\s*true/u);
    expect(compose).toMatch(/cap_drop:[\s\S]*(?:ALL|\[ALL\])/u);
    expect(compose).toMatch(/cap_drop:\s*!override/u);
    expect(compose).toMatch(/security_opt:\s*!override/u);
    expect(compose).toMatch(
      /sysctls:\s*\n\s*net\.ipv4\.ip_unprivileged_port_start:\s*["']?0["']?/u,
    );
    expect(compose).toMatch(/tmpfs:\s*!override[\s\S]*\/tmp:size=16m/u);
    expect(compose).toMatch(/user:\s*["']1000:1000["']/u);
    expect(compose).toContain("DLS_SECRETS_DIR");
    expect(compose).toContain("DLS_S3_ACCESS_KEY_FILE");
    expect(compose).toContain("DLS_S3_SECRET_KEY_FILE");
    expect(compose).toContain("setup_token");
    expect(compose).toContain("session_pepper");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("build: !reset null");
    for (const service of ["API", "WORKER", "WEB", "CADDY"]) {
      expect(compose).toContain(`DLS_${service}_IMAGE_DIGEST`);
    }
    expect(compose).toContain("DLS_IMAGE_REGISTRY");
    expect(compose).toContain("DLS_IMAGE_TAG");
    expect(compose).toContain("/postgres:/var/lib/postgresql");
    expect(compose).not.toContain("/run/dls-s3-secrets");
    expect(compose).toMatch(
      /migrator:\s*\n\s*build:\s*!reset null[\s\S]*?image:[^\r\n]*DLS_API_IMAGE_DIGEST[\s\S]*?networks:\s*\[internal\]/u,
    );
    expect(compose.match(/PUBLIC_BASE_URL:\s*https:\/\/\$\{DLS_DOMAIN/gu)).toHaveLength(2);
    expect(compose.match(/MAIL_TRANSPORT_URL:\s*\$\{DLS_MAIL_TRANSPORT_URL/gu)).toHaveLength(2);
    expect(compose.match(/MAIL_FROM:\s*\$\{DLS_MAIL_FROM/gu)).toHaveLength(2);
    expect(compose.match(/DLS_DOMAIN:\s*\$\{DLS_DOMAIN/gu)).toHaveLength(1);
    expect(compose.match(/DLS_TLS_EMAIL:\s*\$\{DLS_TLS_EMAIL/gu)).toHaveLength(1);
    for (const variable of [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_PRIVATE_BUCKET",
      "S3_STAGING_BUCKET",
      "S3_PUBLIC_BUCKET",
      "S3_FORCE_PATH_STYLE",
    ]) {
      expect(
        compose.match(new RegExp(`${variable}:\\s*["']?\\$\\{DLS_${variable}`, "gu")),
      ).toHaveLength(2);
    }
  });

  it("ships a secret-free production environment template and Caddy policy", async () => {
    const compose = await readFile(resolve(root, "compose.prod.yaml"), "utf8");
    const environment = await readFile(resolve(root, ".env.production.example"), "utf8");
    const caddy = await readFile(resolve(root, "ops/caddy/Caddyfile.production"), "utf8");
    const gitignore = await readFile(resolve(root, ".gitignore"), "utf8");
    expect(environment).toContain("DLS_DOMAIN=");
    expect(environment).toContain("DLS_DATA_DIR=");
    expect(environment).toContain("DLS_IMAGE_REGISTRY=");
    expect(environment).toContain("DLS_API_IMAGE_DIGEST=sha256:");
    expect(environment).toContain("DLS_MAIL_FROM=");
    expect(environment).toContain("DLS_CONTACT_CONSENT_VERSION=");
    expect(environment).toContain("DLS_CONTACT_CONSENT_SHA256=");
    expect(environment).toContain("DLS_S3_STAGING_BUCKET=");
    expect(environment).not.toMatch(/(password|secret|private[_-]?key)\s*=\s*[^\r\n#]+/iu);
    expect(caddy).toContain("https://");
    expect(caddy).toContain("redir https://");
    expect(caddy).toContain("tls");
    expect(caddy).toContain("http://127.0.0.1:8081");
    expect(caddy).toContain("reverse_proxy api:3001");
    expect(compose).toContain("http://127.0.0.1:8081/healthz");
    expect(compose).not.toContain("https://127.0.0.1/health/live");
    expect(gitignore).toContain("!.env.production.example");
  });

  it("generates matched key capabilities and runs every release safety gate", async () => {
    const secretGenerator = await readFile(
      resolve(root, "ops/scripts/generate-development-secrets.mjs"),
      "utf8",
    );
    const scripts = await Promise.all(
      ["deploy.ps1", "deploy.sh", "rollback.ps1", "rollback.sh"].map((name) =>
        readFile(resolve(root, "ops/scripts", name), "utf8"),
      ),
    );
    const dockerfile = await readFile(resolve(root, "Dockerfile"), "utf8");
    for (const init of ["init-secrets.ps1", "init-secrets.sh"]) {
      const text = await readFile(resolve(root, "ops/scripts", init), "utf8");
      expect(text).toContain("generate-development-secrets.mjs");
      expect(text).toMatch(/rotate/iu);
      expect(text).toMatch(/600|inheritance:r|chmod/iu);
    }
    expect(secretGenerator).toContain('generateKeyPairSync("x25519")');
    expect(secretGenerator).toContain('"--directory"');
    expect(secretGenerator).toContain('"--rotate"');
    expect(dockerfile).toContain("runtime-reconcile.mjs");
    expect(dockerfile).toContain("verify-audit.mjs");
    expect(dockerfile).toContain("migration-status.mjs");
    expect(dockerfile).toMatch(
      /FROM \$\{CADDY_IMAGE\} AS caddy[\s\S]*mkdir -p \/data \/config[\s\S]*chown -R 1000:1000 \/data \/config/u,
    );

    for (const script of scripts.slice(0, 2)) {
      expect(script).toMatch(/backup/iu);
      expect(script).toMatch(/disk|free/iu);
      expect(script).toMatch(/migrat/iu);
      expect(script).toMatch(/health\/ready|deep health/iu);
      expect(script).toMatch(/verify-audit/iu);
      expect(script).toContain("node ops/scripts/verify-audit.mjs");
      expect(script).not.toContain("node_modules/tsx");
      expect(script).toContain("runtime-reconcile.mjs");
      expect(script).toMatch(
        /(?:exec|Invoke-Docker exec)[^\r\n]*worker[^\r\n]*runtime-reconcile/iu,
      );
      expect(script).toContain("DLS_IMAGE_TAG");
    }
    for (const script of scripts.slice(2)) {
      expect(script).toMatch(/compatib/iu);
      expect(script).toMatch(/restore/iu);
      expect(script).toContain("node ops/scripts/migration-status.mjs");
      expect(script).not.toContain("node_modules/tsx");
      expect(script).not.toMatch(/migration.*down|migrat(?:e|or)[^\r\n]*down/iu);
    }
  });
});
