# Simulation, E2E, Security, and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete isolated simulation mode, prove all critical journeys in real browsers with real cryptography, enforce security/fault/dependency gates, and deliver reproducible Windows Docker development plus Linux Docker deployment, backup, restore, and storage-migration operations.

**Architecture:** Simulation mode runs in a separate database/storage namespace and never modifies formal clocks or public state. Playwright drives the full Compose stack and Mailpit. Security suites attack HTTP, browser, archive, storage, database, and dependency boundaries. Production Compose uses Caddy TLS, least-privilege containers, host-mounted Linux data directories by default, read-only secret files, and reversible versioned deployment. PowerShell and POSIX scripts implement equivalent operational gates.

**Tech Stack:** Docker Compose, Playwright 1.62.1, axe 4.12.1, Vitest 4.1.10, PostgreSQL 18.4 tools, Caddy 2.11.4, Mailpit 1.30.6, optional MinIO `RELEASE.2025-10-15T17-29-55Z`, Trivy 0.73.0, pnpm/Cargo audit, PowerShell 7 and POSIX shell.

## Global Constraints

- Simulation APIs/routes exist only when `DLS_TEST_MODE=true`, an isolated test database URL and test storage roots/buckets are configured, and the request uses an authenticated owner test session. Production boot rejects `DLS_TEST_MODE=true`.
- Test/simulation emails start with `【测试】`, target a configured allowlist, use Mailpit in local acceptance, and cannot share notification/idempotency rows with formal workflows.
- E2E uses the same production browser crypto and WASM. Reduced KDF profiles are accepted only in test mode and production-schema tests prove they are rejected elsewhere.
- Acceptance scripts fail on skipped required tests, stale generated files, dirty generated evidence, unpinned images/dependencies, high/critical known vulnerabilities without an explicit time-bounded reviewed exception, or any external network mail target.
- Deployment templates contain no real domain, person, SMTP/S3 credential, database password, or usable stage key.
- Backup/restore is user-initiated; there is no claim of automatic backup. A backup is not accepted until restored into blank resources and verified.

---

### Task 1: Implement isolated simulation namespaces and virtual time

**Files:**
- Create: `packages/application/src/simulation/simulation-clock.ts`
- Create: `packages/application/src/simulation/create-simulation.ts`
- Create: `packages/application/src/simulation/advance-simulation.ts`
- Create: `packages/application/src/simulation/reset-simulation.ts`
- Create: `packages/application/src/simulation/simulation.test.ts`
- Create: `packages/persistence/migrations-test/001_simulation_schema.up.sql`
- Create: `packages/persistence/migrations-test/001_simulation_schema.down.sql`
- Create: `apps/api/src/simulation/simulation.controller.ts`
- Create: `apps/api/src/simulation/simulation.module.ts`
- Create: `apps/worker/src/simulation/simulation-jobs.ts`
- Create: `apps/web/src/app/admin/simulations/page.tsx`
- Create: `apps/web/src/features/simulation/simulation-console.tsx`
- Create: `tests/integration/simulation-isolation.test.ts`

- [x] **Step 1: Write failing isolation and virtual-clock tests**

Assert simulation tables do not exist in the formal database, test IDs cannot be queried by formal repositories, formal scheduler always uses PostgreSQL time, virtual clock cannot move backward, advances are owner-authorized/idempotent/audited, test mail is allowlisted/prefixed, test public objects never resolve on `/legacy`, and production/test-mode config combinations fail closed.

- [x] **Step 2: Implement a separate test composition root**

Create simulation aggregates with synthetic owner/contact/package data inside the test database and storage namespace. `SimulationClock` reads `simulation.clock_state`; only simulation use cases receive it. Advancing time runs due simulation transitions synchronously or through namespaced `simulation.*` jobs and returns a deterministic event summary.

- [x] **Step 3: Implement the simulation console**

Allow creating/resetting a synthetic scenario, advancing to check-in due, contact decision, recovery threshold, release countdown milestones, SMTP failure/retry, and final publication. Clearly label every surface `测试模式`; never reuse formal action endpoints.

- [x] **Step 4: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/simulation-isolation.test.ts
pnpm.cmd --filter @dls/application test -- simulation.test.ts
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
git add packages/application/src/simulation packages/persistence/migrations-test apps/api/src/simulation apps/worker/src/simulation apps/web/src/app/admin/simulations apps/web/src/features/simulation tests/integration/simulation-isolation.test.ts packages/contracts
git commit -m "feat: add isolated workflow simulation mode"
```

---

### Task 2: Build deterministic full-stack E2E fixtures

**Files:**
- Create: `tests/e2e/playwright.config.ts`
- Create: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/global-teardown.ts`
- Create: `tests/e2e/fixtures/app.ts`
- Create: `tests/e2e/fixtures/mailpit.ts`
- Create: `tests/e2e/fixtures/crypto-users.ts`
- Create: `tests/e2e/fixtures/synthetic-legacy.ts`
- Create: `tests/e2e/fixtures/assert-no-secrets.ts`
- Create: `tests/e2e/fixtures/test.zip`

- [ ] **Step 1: Write a failing stack-readiness fixture test**

Global setup starts a unique Compose project with `test` profile, waits for API/web/worker/PostgreSQL/Mailpit health, applies production plus test migrations, verifies blank formal/test state, and rejects any SMTP host not equal to the Compose Mailpit service.

- [ ] **Step 2: Implement API/UI/mail helpers without bypassing business behavior**

Helpers may read Mailpit messages and extract fragment links, but setup/login/invite/accept/upload/share/decision/recovery/publication actions go through browser UI and generated API contracts. Synthetic contacts use real X25519 keys, encrypted private keys, VSS shares, and secretstream files. `test.zip` is generated from committed deterministic fixture sources and contains root `will.md` plus a small binary file.

- [ ] **Step 3: Instrument secret detection**

Register known synthetic passwords, raw keys, shares, tokens, codes, will text, and fragment values with `assert-no-secrets`. Scan browser console/network URLs/HTML/storage, Caddy/API/worker logs, pg-boss payloads, and Mailpit messages according to their allowed field policy after every test.

- [ ] **Step 4: Verify and commit fixtures**

```powershell
pnpm.cmd exec playwright test tests/e2e/fixtures --project=chromium
git add tests/e2e
git commit -m "test: establish real full stack e2e fixtures"
```

---

### Task 3: Automate every critical user journey

**Files:**
- Create: `tests/e2e/01-bootstrap-arm.spec.ts`
- Create: `tests/e2e/02-checkin-alive-cancel.spec.ts`
- Create: `tests/e2e/03-release-owner-cancel.spec.ts`
- Create: `tests/e2e/04-release-publish.spec.ts`
- Create: `tests/e2e/05-owner-password-recovery.spec.ts`
- Create: `tests/e2e/06-contact-rotation-reshare.spec.ts`
- Create: `tests/e2e/07-upload-restart-resume.spec.ts`
- Create: `tests/e2e/08-role-and-error-boundaries.spec.ts`

- [ ] **Step 1: Bootstrap and arm from a blank system**

Create owner/VK, invite at least three contacts through Mailpit, accept consent/create contact keys, upload/encrypt/activate ZIP, generate both VSS share sets, test SMTP, accept irreversible risk, and assert `ARMED` plus audit integrity.

- [ ] **Step 2: Check-in and both death-workflow terminal paths**

Use isolated simulation time to trigger death confirmation. First run has one contact choose alive and verifies immediate cancellation/rescheduled timer/disclosure mail. Second reaches threshold and owner cancels with MP before deadline. Third reaches threshold, advances past publish lock, verifies owner cannot cancel, waits for publication, renders sanitized will, downloads/range-resumes ZIP, and compares plaintext digest/content.

- [ ] **Step 3: Recover owner password**

Request/start through primary email, have recovery threshold contacts approve with real shares, consume the 8-digit primary-email code and ephemeral sealed VK, rewrap under a new MP, assert old MP/sessions fail, new MP logs in/checks in, and death timer was never paused before success.

- [ ] **Step 4: Rotate contacts/packages and restart services**

Change contact password without changing CPK/share usability; remove/reinvite contact and require new share generation; interrupt a filesystem upload and resume/abort; restart API/worker/PostgreSQL and verify idempotent continuation; activate a new package and prove old ciphertext cleanup cannot touch current object.

- [ ] **Step 5: Verify role/error boundaries**

Cross-use owner/contact cookies, replay tokens/codes/idempotency keys, navigate closed/unknown resources, and ensure no private-data flash or enumeration. Test mobile Chromium and desktop Chromium for every critical decision; run Firefox/WebKit smoke for login/public/download.

- [ ] **Step 6: Run and commit**

```powershell
pnpm.cmd test:e2e
git add tests/e2e
git commit -m "test: cover complete digital legacy journeys"
```

---

### Task 4: Add adversarial security and property gates

**Files:**
- Create: `tests/security/authentication-abuse.test.ts`
- Create: `tests/security/csrf-origin-cors.test.ts`
- Create: `tests/security/injection-mass-assignment.test.ts`
- Create: `tests/security/ssrf-headers-redirects.test.ts`
- Create: `tests/security/archive-storage-paths.test.ts`
- Create: `tests/security/token-log-redaction.test.ts`
- Create: `tests/security/publication-authorization.test.ts`
- Create: `tests/security/crypto-property.test.ts`
- Create: `tests/security/secret-scan.ts`
- Create: `ops/security/trivy.yaml`
- Create: `ops/security/allowed-vulnerabilities.yaml`
- Create: `ops/scripts/security-scan.ps1`
- Create: `ops/scripts/security-scan.sh`

- [ ] **Step 1: Write attack-focused failing tests**

Exercise SQL/JSON/header/log injection, stored/reflected Markdown XSS, prototype pollution keys, unknown/mass-assigned fields, CSRF/simple form, Origin/Fetch-Site, CORS preflight, Host/forwarded-header poisoning, SMTP/URL SSRF, open redirect, Unicode email/name ambiguities, object/path traversal, ZIP parser corpus, Range abuse, cookie swapping, session fixation, token brute-force/expiry/replay, request races, and public object enumeration.

- [ ] **Step 2: Add bounded property tests**

Generate at least 10,000 random malformed protocol/envelope/share/frame/range/path inputs with deterministic seeds. Assert parsers never hang/crash/allocate beyond configured budgets, accepted encodings round-trip canonically, and any one-bit mutation of authenticated data is rejected.

- [ ] **Step 3: Add source/lock/image scanning**

`secret-scan.ts` rejects committed private-key/credential patterns and known generated test secrets outside approved fixtures. Security scripts run `pnpm audit --audit-level high`, Cargo/RustSec audit in the pinned Rust builder, and `aquasec/trivy:0.73.0` against filesystem, lockfiles, and built images. Pin Trivy by image digest when first resolved and commit the digest. Allowlist entries require advisory/CVE, rationale, compensating control, owner, creation date, and expiry <=30 days.

- [ ] **Step 4: Run the full gate and commit**

```powershell
pnpm.cmd test:security
pwsh -File ops/scripts/security-scan.ps1
git add tests/security ops/security ops/scripts/security-scan.ps1 ops/scripts/security-scan.sh
git commit -m "test: add adversarial security gates"
```

---

### Task 5: Create Linux production Compose and deployment lifecycle

**Files:**
- Create: `compose.prod.yaml`
- Create: `.env.production.example`
- Create: `ops/caddy/Caddyfile.production`
- Create: `ops/scripts/init-secrets.ps1`
- Create: `ops/scripts/init-secrets.sh`
- Create: `ops/scripts/deploy.ps1`
- Create: `ops/scripts/deploy.sh`
- Create: `ops/scripts/rollback.ps1`
- Create: `ops/scripts/rollback.sh`
- Create: `tests/deployment/production-compose.test.ts`
- Create: `docs/operations/windows-development.md`
- Create: `docs/operations/linux-deployment.md`
- Create: `docs/operations/upgrade-rollback.md`

- [ ] **Step 1: Write failing production topology tests**

Assert image references use immutable application version/digest, only 80/443 are published, Caddy redirects HTTP and manages TLS, PostgreSQL/API/worker are internal, containers run non-root with dropped capabilities/read-only rootfs/tmpfs where possible, restart/health/resource/log rotation are configured, secret files are mounted to the correct process only, default storage uses `${DLS_DATA_DIR}` host paths, and MinIO is absent.

- [ ] **Step 2: Implement secret generation and configuration validation**

Scripts resolve and validate an explicit destination below the caller-supplied deployment directory, create files with restrictive permissions, generate independent database/session/pepper/release/recovery/ingress secrets, never print values, and refuse overwrite without an explicit rotate command. Production example documents filesystem default and optional S3 variables.

- [ ] **Step 3: Implement versioned deploy/rollback**

Deploy checks disk space/config/backups, pulls/builds an explicit version, migrates under advisory lock, starts services, waits for deep health, runs smoke/audit/storage consistency checks, and then marks the version current. Rollback may switch application image only when schema compatibility permits; otherwise it stops and points to the documented database restore procedure.

- [ ] **Step 4: Document Windows and Linux procedures**

Windows guide covers Docker Desktop WSL2, CRLF/path/volume/firewall issues, default Compose, optional S3 profile, logs, Mailpit, tests, and clean shutdown without volume deletion. Linux guide covers supported x86_64/arm64 host, Docker/Compose, DNS/TLS, `/srv/dls` permissions, SMTP, default filesystem volumes, optional S3, upgrades, monitoring, and external-review blockers.

- [ ] **Step 5: Verify and commit**

```powershell
docker compose -f compose.yaml -f compose.prod.yaml config --quiet
pnpm.cmd exec vitest run tests/deployment/production-compose.test.ts
git add compose.prod.yaml .env.production.example ops/caddy/Caddyfile.production ops/scripts/init-secrets.* ops/scripts/deploy.* ops/scripts/rollback.* tests/deployment/production-compose.test.ts docs/operations/windows-development.md docs/operations/linux-deployment.md docs/operations/upgrade-rollback.md
git commit -m "ops: add linux docker deployment lifecycle"
```

---

### Task 6: Implement backup, restore, verification, and optional storage migration

**Files:**
- Create: `packages/storage/src/cli/inventory.ts`
- Create: `packages/storage/src/cli/migrate-storage.ts`
- Create: `packages/storage/src/cli/verify-storage.ts`
- Create: `tests/integration/storage-migration.test.ts`
- Create: `ops/scripts/backup.ps1`
- Create: `ops/scripts/backup.sh`
- Create: `ops/scripts/restore.ps1`
- Create: `ops/scripts/restore.sh`
- Create: `ops/scripts/verify-restore.ps1`
- Create: `ops/scripts/verify-restore.sh`
- Create: `tests/deployment/backup-restore.test.ts`
- Create: `docs/operations/backup-restore.md`
- Create: `docs/operations/filesystem-s3-migration.md`

- [ ] **Step 1: Write failing consistency/restore tests**

Seed private ciphertext, staged workflow material, public publication, audit chains, and jobs. Backup, destroy only an explicitly named disposable Compose project/volumes, restore into blank database/object roots, and assert row counts, object bytes/digests, active references, public download, stage-key decryptability, audit chains, migrations, and job reconciliation match.

- [ ] **Step 2: Implement an operator-driven consistent backup**

Enter maintenance mode, stop new commands, drain/stop worker at a safe point, record migration/image/key-version manifest, `pg_dump` in custom format, archive default filesystem object roots without following links, hash every artifact, then resume. On S3, inventory/copy versioned objects through `StoragePort`; never embed cloud credentials in the archive. Encrypting backup media is an operator responsibility documented explicitly.

- [ ] **Step 3: Implement blank-target restore and verifier**

Restore refuses nonblank targets unless a separate destructive approval flag is supplied. It restores DB/objects, applies only compatible migrations, starts read-only verification, checks manifest/object/audit/publication/job consistency, then permits normal startup. Any mismatch leaves maintenance mode enabled.

- [ ] **Step 4: Implement optional filesystem↔S3 migration**

Under maintenance mode, inventory all DB-referenced and staging objects, copy with byte/hash verification and resumable journal, re-run shared storage contract/read-range checks, atomically switch `STORAGE_DRIVER`, and retain the source until a separately authorized cleanup. Reject live switching with unresolved/missing/conflicting objects.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/storage-migration.test.ts tests/deployment/backup-restore.test.ts
pwsh -File ops/scripts/backup.ps1 -ProjectName dls-acceptance -Destination .\artifacts\backup-test
pwsh -File ops/scripts/verify-restore.ps1 -Backup .\artifacts\backup-test
git add packages/storage/src/cli tests/integration/storage-migration.test.ts ops/scripts/backup.* ops/scripts/restore.* ops/scripts/verify-restore.* tests/deployment/backup-restore.test.ts docs/operations/backup-restore.md docs/operations/filesystem-s3-migration.md
git commit -m "ops: verify backup restore and storage migration"
```

---

### Task 7: Assemble the single local acceptance gate and final evidence

**Files:**
- Create: `ops/scripts/acceptance.ps1`
- Create: `ops/scripts/acceptance.sh`
- Create: `ops/scripts/write-evidence.ts`
- Update: `compose.test.yaml`
- Create: `tests/deployment/cross-platform-scripts.test.ts`
- Create: `docs/operations/incident-response.md`
- Create: `docs/operations/monitoring-alerts.md`
- Create: `docs/operations/production-readiness.md`
- Create: `docs/acceptance/local-v1-evidence.md`

- [ ] **Step 1: Implement fail-fast but evidence-preserving acceptance scripts**

Both scripts run, in this order: version/pin checks; format/lint/type; unit; migrations up/down/up; integration/concurrency; Rust/WASM crypto; both storage adapters; email; production builds; default Compose smoke; simulations; visual/a11y; full E2E; security/property/dependency/image scans; publication crash matrix; production Compose validation; backup/blank restore; audit/storage/publication reconciliation. Each child command's exit code/duration is captured; a required skip is failure.

- [ ] **Step 2: Generate a deterministic evidence document**

`write-evidence.ts` records Git commit/dirty status, OS/architecture, exact tool/image/migration/protocol versions, command results, test counts, artifact SHA-256, Beijing start/end timestamps, visual/a11y/security summaries, restore result, and unresolved external blockers. It redacts environment and secret-shaped values.

- [ ] **Step 3: Add operational runbooks**

Incident response covers suspected password/key/script/database/storage/mail compromise, publish-stage failure, lost stage key, audit mismatch, disk exhaustion, and unintended public exposure. Monitoring defines health/job/dead-letter/disk/DB/audit/storage/TLS/backup signals without secret payloads. Production readiness has explicit independent cryptographic/legal/manual penetration/restore approvals and cannot be self-checked by automated tests.

- [ ] **Step 4: Run the complete Windows gate**

```powershell
pwsh -File ops/scripts/acceptance.ps1
```

Expected: exit 0, `docs/acceptance/local-v1-evidence.md` has no failed/skipped required gate, and `git diff --exit-code` reports only the newly generated evidence expected by the script.

- [ ] **Step 5: Run the Linux-container equivalent**

```powershell
docker compose --profile test up --build --abort-on-container-exit acceptance
```

Expected: acceptance container exits 0 and writes a Linux evidence artifact with matching protocol/vector/application hashes.

- [ ] **Step 6: Commit final runbooks and evidence**

```powershell
git add ops/scripts/acceptance.ps1 ops/scripts/acceptance.sh ops/scripts/write-evidence.ts tests/deployment/cross-platform-scripts.test.ts docs/operations/incident-response.md docs/operations/monitoring-alerts.md docs/operations/production-readiness.md docs/acceptance/local-v1-evidence.md
git commit -m "test: complete local v1 acceptance gate"
```

- [ ] **Step 7: Perform the final verification-before-completion check**

Run `git status --short`, verify the user's pre-existing documentation changes are still separate, inspect the final evidence, and do not claim production readiness. The correct completion claim is “complete local V1 passes all automated acceptance gates; named independent reviews and operator approvals remain production blockers.”
