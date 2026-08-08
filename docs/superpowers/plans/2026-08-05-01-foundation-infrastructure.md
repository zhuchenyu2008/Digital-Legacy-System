# Foundation and Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible monorepo, typed configuration, bootable app skeletons, Docker topology, and contract-generation gate on which every later work package depends.

**Architecture:** pnpm workspaces and TypeScript project references provide the build graph without Nx/Turborepo. NestJS/Fastify powers API and worker processes; Next.js powers the web app. One multi-stage Dockerfile produces independent targets. PostgreSQL, Mailpit, Caddy, and named filesystem volumes run by default; MinIO exists only in the `s3` profile.

**Tech Stack:** Node.js 24.18.0, pnpm 11.20.0, TypeScript 6.0.3, tsx 4.23.5, Biome 2.5.7, Vitest 4.1.10, Next.js 16.3.0, React 19.2.8, NestJS 11.1.28, Fastify 5.11.2, Zod 4.4.3, PostgreSQL 18.4, Caddy 2.11.4, Mailpit 1.30.6, optional MinIO `RELEASE.2025-10-15T17-29-55Z`.

## Global Constraints

- Work from `D:\code\Digital-Legacy-System` and preserve all pre-existing uncommitted documentation changes.
- Pin every direct dependency to an exact version. `save-exact=true`; never use `^`, `~`, `latest`, floating Docker tags, or uncommitted generated output.
- Environment parsing happens once at process startup. Application modules receive a validated immutable `RuntimeConfig`; they do not read `process.env` directly.
- Container health checks must test real service readiness. `depends_on` uses `condition: service_healthy` for stateful dependencies.
- Default startup must not require S3 credentials or start MinIO.

---

### Task 1: Pin the workspace and toolchain

**Files:**
- Create: `.node-version`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `vitest.workspace.ts`
- Create: `tests/tooling/version-pins.test.ts`

- [x] **Step 1: Write the failing pin-policy test**

`tests/tooling/version-pins.test.ts` loads every `package.json`, asserts root `packageManager === "pnpm@11.20.0"`, `engines.node === "24.18.0"`, and rejects dependency values beginning with `^`, `~`, `>`, `<`, `*`, `workspace:^`, or `workspace:~`. It also asserts `.node-version` contains exactly `24.18.0`.

- [x] **Step 2: Run the test and observe the expected failure**

```powershell
pnpm.cmd exec vitest run tests/tooling/version-pins.test.ts
```

Expected: failure because the root workspace manifests do not exist.

- [x] **Step 3: Add the root manifests**

Root scripts must include `check`, `test:unit`, `test:integration`, `test:crypto`, `test:storage`, `test:e2e`, `test:security`, `test:deployment`, `build`, `openapi:generate`, `openapi:check`, and `acceptance`. Set `packageManager`, `engines`, `private: true`, and pnpm overrides for security patches. Workspace globs are `apps/*` and `packages/*`.

Use exact root dev dependencies: TypeScript `6.0.3`, tsx `4.23.5`, Vitest and coverage `4.1.10`, Biome `2.5.7`, Playwright `1.62.1`, axe Playwright `4.12.1`, and `dotenv` `17.4.2`.

- [x] **Step 4: Install and lock dependencies**

```powershell
corepack enable
pnpm.cmd install
pnpm.cmd exec vitest run tests/tooling/version-pins.test.ts
pnpm.cmd exec biome check .
```

Expected: all commands exit 0 and `pnpm-lock.yaml` is created.

- [x] **Step 5: Commit the workspace foundation**

```powershell
git add .node-version .npmrc .gitignore .dockerignore package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json biome.json vitest.workspace.ts tests/tooling/version-pins.test.ts
git commit -m "build: pin workspace toolchain"
```

---

### Task 2: Create package boundaries and enforce dependency direction

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`
- Create: `packages/application/package.json`, `packages/application/tsconfig.json`, `packages/application/src/index.ts`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`
- Create: `packages/crypto/package.json`, `packages/crypto/tsconfig.json`, `packages/crypto/src/index.ts`
- Create: `packages/persistence/package.json`, `packages/persistence/tsconfig.json`, `packages/persistence/src/index.ts`
- Create: `packages/storage/package.json`, `packages/storage/tsconfig.json`, `packages/storage/src/index.ts`
- Create: `packages/email-templates/package.json`, `packages/email-templates/tsconfig.json`, `packages/email-templates/src/index.ts`
- Create: `packages/test-fixtures/package.json`, `packages/test-fixtures/tsconfig.json`, `packages/test-fixtures/src/index.ts`
- Create: `tests/architecture/dependency-boundaries.test.ts`

- [x] **Step 1: Write the failing architecture test**

The test walks TypeScript imports with the compiler API and enforces:

```ts
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
```

It also rejects `process.env` outside `apps/*/src/config` and imports from another package's `src/` path.

- [x] **Step 2: Run and see it fail on missing manifests**

```powershell
pnpm.cmd exec vitest run tests/architecture/dependency-boundaries.test.ts
```

- [x] **Step 3: Create manifests, references, and public entry points**

All internal dependencies use exact `workspace:*`. Add conditional export maps where needed: `@dls/crypto/browser`, `@dls/crypto/node`, `@dls/contracts/client`, and `@dls/storage/testing`. Keep every initial `index.ts` side-effect free.

- [x] **Step 4: Verify graph and type checking**

```powershell
pnpm.cmd exec vitest run tests/architecture/dependency-boundaries.test.ts
pnpm.cmd exec tsc --build --pretty false
```

Expected: both exit 0.

- [x] **Step 5: Commit package boundaries**

```powershell
git add apps packages tests/architecture/dependency-boundaries.test.ts
git commit -m "build: establish package boundaries"
```

---

### Task 3: Implement typed runtime configuration

**Files:**
- Create: `packages/contracts/src/config/runtime-config.ts`
- Create: `packages/contracts/src/config/runtime-config.test.ts`
- Create: `packages/contracts/src/config/index.ts`
- Create: `.env.example`
- Create: `ops/secrets/README.md`

- [x] **Step 1: Write failing configuration tests**

Cover defaults, invalid URLs, weak session secrets, production debug flags, filesystem defaults, and conditional S3 validation. The public interface is:

```ts
export type RuntimeConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  publicBaseUrl: URL;
  databaseUrl: string;
  storage:
    | { driver: "filesystem"; privateRoot: string; stagingRoot: string; publicRoot: string }
    | { driver: "s3"; endpoint?: URL; region: string; privateBucket: string; publicBucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
  mail: { transportUrl: string; from: string };
  security: { sessionSecret: Uint8Array; tokenPepper: Uint8Array; trustedProxyHops: number };
}>;

export function parseRuntimeConfig(env: Record<string, string | undefined>): RuntimeConfig;
```

The tests assert that absent `STORAGE_DRIVER` selects filesystem and does not require any `S3_*` variable; selecting `s3` requires all bucket and credential fields.

- [x] **Step 2: Run the focused tests and observe missing-export failures**

```powershell
pnpm.cmd --filter @dls/contracts test -- runtime-config.test.ts
```

- [x] **Step 3: Implement parsing with Zod**

Use Zod `4.4.3`. Decode session secret and token pepper from base64, require 32 bytes minimum, normalize paths without creating directories, freeze the returned object, and report variable names without echoing secret values.

- [x] **Step 4: Document development secret generation**

`.env.example` contains safe non-secret defaults and blank secret fields. `ops/secrets/README.md` gives PowerShell and Linux OpenSSL commands that emit base64 secrets into user-owned files; generated files are ignored by Git.

- [x] **Step 5: Verify and commit**

```powershell
pnpm.cmd --filter @dls/contracts test
pnpm.cmd exec tsc --build --pretty false
git add .env.example ops/secrets packages/contracts
git commit -m "feat: validate runtime configuration"
```

---

### Task 4: Boot API, worker, and web health surfaces

**Files:**
- Create: `apps/api/src/config/load-config.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.service.ts`
- Create: `apps/api/src/health/health.controller.test.ts`
- Create: `apps/worker/src/config/load-config.ts`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/worker.module.ts`
- Create: `apps/worker/src/health/worker-heartbeat.ts`
- Create: `apps/worker/src/health/worker-heartbeat.test.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/health/route.ts`
- Create: `apps/web/src/app/health/route.test.ts`
- Create: `apps/web/src/app/globals.css`
- Update: `apps/api/package.json`
- Update: `apps/worker/package.json`
- Update: `apps/web/package.json`
- Update: `pnpm-lock.yaml`

- [x] **Step 1: Add failing process-level health tests**

API contract:

```json
{"status":"ok","service":"api","version":"0.1.0"}
```

`GET /health/live` checks process liveness only; `GET /health/ready` checks PostgreSQL, storage directories/buckets, and worker heartbeat freshness. Web `GET /health` checks only the Next.js process. Worker writes a heartbeat row through a temporary `WorkerHeartbeatPort` stub until persistence arrives in work package 2.

- [x] **Step 2: Run and observe failures**

```powershell
pnpm.cmd --filter @dls/api test -- health.controller.test.ts
pnpm.cmd --filter @dls/worker test -- worker-heartbeat.test.ts
pnpm.cmd --filter @dls/web test -- health/route.test.ts
```

- [x] **Step 3: Implement minimal bootstraps**

Use NestJS packages `11.1.28`, Fastify adapter `11.1.28`, Fastify `5.11.2`, RxJS `7.8.2`, reflect-metadata `0.2.2`, Helmet `8.3.0`, and React/DOM `19.2.8`. Disable `x-powered-by`, set a request ID, configure JSON logging with a central redaction list, and bind to `0.0.0.0` only inside the container.

- [x] **Step 4: Verify the processes without Docker**

```powershell
pnpm.cmd --filter @dls/api test
pnpm.cmd --filter @dls/worker test
pnpm.cmd --filter @dls/web test
pnpm.cmd --filter @dls/web build
```

- [x] **Step 5: Commit process skeletons**

```powershell
git add apps
git commit -m "feat: boot api worker and web services"
```

---

### Task 5: Add Docker Desktop and Linux Compose topology

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `compose.test.yaml`
- Create: `ops/caddy/Caddyfile`
- Create: `ops/postgres/init/001-roles.sh`
- Create: `ops/scripts/compose-smoke.ps1`
- Create: `ops/scripts/compose-smoke.sh`
- Create: `tests/deployment/compose-config.test.ts`

- [x] **Step 1: Write the failing Compose policy test**

Parse `docker compose config --format json` and assert:

- default services are `web`, `api`, `worker`, `postgres`, `mailpit`, and `caddy`;
- `minio` and `minio-init` have profile `s3` only;
- named volumes include `postgres_data`, `private_objects`, `staging_objects`, and `public_objects`;
- only Caddy publishes the application HTTP port by default;
- stateful services have health checks, read-only filesystems where practical, and no hard-coded production secrets.

- [x] **Step 2: Run and observe the missing-Compose failure**

```powershell
pnpm.cmd exec vitest run tests/deployment/compose-config.test.ts
```

- [x] **Step 3: Implement multi-stage images and profiles**

Resolve and pin immutable digests for readable tags `node:24.18.0-bookworm-slim`, `postgres:18.4-bookworm`, `caddy:2.11.4-alpine`, `axllent/mailpit:v1.30.6`, and optional `minio/minio:RELEASE.2025-10-15T17-29-55Z`; commit tag plus digest and never use a floating tag. `minio-init` runs the repository's AWS SDK bucket initializer from the test image, so no floating MinIO client image is needed. `ops/postgres/init/001-roles.sh` creates the API, worker, migrator, backup, and health login-role shells from Docker secret files without printing passwords; schema migrations grant their privileges later. Dockerfile targets are `web`, `api`, `worker`, and `test`. Run as non-root; copy only production dependencies and built outputs. Default storage mounts the three object volumes under `/var/lib/dls/objects/*`. The optional `s3` profile supplies MinIO endpoint and buckets without altering the default profile.

- [x] **Step 4: Add cross-platform smoke scripts**

Both scripts run config validation, build the images, start default services, poll `/health/ready` through Caddy, verify MinIO is absent, restart API/worker, and verify PostgreSQL plus object volumes survive. Use a Compose project name unique to the repository; cleanup uses `down` without `-v` unless the caller passes an explicit `-DeleteVolumes`/`--delete-volumes` flag.

- [x] **Step 5: Verify default and optional profiles**

```powershell
docker compose config --quiet
pwsh -File ops/scripts/compose-smoke.ps1
docker compose --profile s3 config --quiet
pnpm.cmd exec vitest run tests/deployment/compose-config.test.ts
```

Expected: default smoke exits 0 and `docker compose ps --services` does not list MinIO.

- [x] **Step 6: Commit container topology**

```powershell
git add Dockerfile compose.yaml compose.test.yaml ops/caddy/Caddyfile ops/postgres/init/001-roles.sh ops/scripts/compose-smoke.ps1 ops/scripts/compose-smoke.sh tests/deployment/compose-config.test.ts
git commit -m "build: add docker compose topology"
```

---

### Task 6: Generate and enforce the OpenAPI contract

**Files:**
- Create: `apps/api/src/openapi/generate-openapi.ts`
- Create: `packages/contracts/openapi/openapi.json`
- Create: `packages/contracts/scripts/generate-client.ts`
- Create: `packages/contracts/src/client/generated.ts`
- Create: `packages/contracts/src/client/http-client.ts`
- Create: `packages/contracts/src/client/index.ts`
- Create: `tests/contracts/openapi-drift.test.ts`
- Update: `apps/api/package.json`
- Update: `packages/contracts/package.json`
- Update: `pnpm-lock.yaml`

- [x] **Step 1: Write the failing drift test**

The test boots the Nest module without opening a port, generates sorted OpenAPI JSON, generates the TypeScript client into a temporary directory, and byte-compares both outputs with committed files.

- [x] **Step 2: Run and observe missing artifacts**

```powershell
pnpm.cmd exec vitest run tests/contracts/openapi-drift.test.ts
```

- [x] **Step 3: Implement deterministic generation**

Use `@nestjs/swagger` `11.4.6`, `openapi-typescript` `7.13.0`, and `openapi-fetch` `0.17.0`. Sort schemas, paths, methods, parameters, and tags before serialization. `http-client.ts` accepts an injected `fetch`, base URL, CSRF provider, and request ID provider; it never retries non-idempotent requests automatically.

- [x] **Step 4: Verify generated output and production builds**

```powershell
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
pnpm.cmd build
docker compose build web api worker
```

- [x] **Step 5: Commit the contract gate**

```powershell
git add apps/api/src/openapi packages/contracts/openapi packages/contracts/scripts packages/contracts/src/client tests/contracts package.json pnpm-lock.yaml
git commit -m "build: enforce generated api contract"
```

---

### Task 7: Run the work-package exit gate

**Files:**
- Create: `docs/acceptance/01-foundation.md`

- [x] **Step 1: Run all foundation checks**

```powershell
pnpm.cmd check
pnpm.cmd test:unit
pnpm.cmd openapi:check
pnpm.cmd build
pwsh -File ops/scripts/compose-smoke.ps1
```

- [x] **Step 2: Record reproducible evidence**

Record the exact command, exit code, relevant version output, Docker image digests, and Beijing timestamp in `docs/acceptance/01-foundation.md`. No pasted secrets, connection strings, or environment dumps.

- [x] **Step 3: Commit only the evidence**

```powershell
git add docs/acceptance/01-foundation.md
git commit -m "test: record foundation acceptance"
```
