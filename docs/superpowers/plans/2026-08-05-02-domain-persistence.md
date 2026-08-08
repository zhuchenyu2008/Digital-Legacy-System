# Domain and Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic domain policies and a PostgreSQL persistence layer whose constraints, transactions, outbox, tasks, and audit records remain correct under concurrent requests and worker retries.

**Architecture:** `packages/domain` contains framework-free value objects and transition functions. `packages/application` owns repository, transaction, clock, job, event, and audit ports. `packages/persistence` uses explicit SQL through `pg`; no ORM hides locks or transaction boundaries. pg-boss uses the same PostgreSQL instance but does not replace the domain outbox.

**Tech Stack:** TypeScript 6.0.3, PostgreSQL 18.4, `pg` 8.22.0, pg-boss 12.27.0, UUID 14.0.1, `@js-temporal/polyfill` 0.5.1, Vitest 4.1.10, Docker Compose.

> **Handoff status (August 8, 2026, Beijing):** Task 1 and Task 2 are complete. Independent review findings for Task 2 were fixed in commit `aa6b534`: workflow snapshots now freeze a validated package version, and the mutation gate discovers uncovered numeric comparisons before killing all 16 registered boundary mutations. Fresh gates passed with 227 tests and 100% branch coverage. Tasks 3-7 remain intentionally unchecked. Before Task 3, start Docker Desktop (the daemon was unavailable during handoff); the host Node runtime is 24.14.0 while the pinned project runtime is 24.18.0, so use the pinned Docker image or install the exact host version.

## Global Constraints

- `docs/03-database-design.md` is the normative table/column/index contract; migrations must implement every production table in sections 4–14 and 12 exactly, with only documented additive implementation columns.
- Persist instants as `timestamptz`; persist durations as validated integer seconds/days. Never store a locale-formatted date.
- Transition transactions obtain database time using one `SELECT clock_timestamp()` value and reuse it throughout the decision.
- All externally retryable commands require an owner-scoped idempotency key and a stored response hash.
- Domain outbox insertion and aggregate mutation happen in the same transaction. External I/O happens only after commit.
- Tests never mutate the host clock. Integration tests use seeded deadlines or isolated simulation tables.

---

### Task 1: Implement IDs, time, thresholds, and policy value objects

**Files:**
- Create: `packages/domain/src/shared/aggregate-id.ts`
- Create: `packages/domain/src/shared/instant.ts`
- Create: `packages/domain/src/shared/version.ts`
- Create: `packages/domain/src/policies/checkin-policy.ts`
- Create: `packages/domain/src/policies/threshold-policy.ts`
- Create: `packages/domain/src/policies/release-policy.ts`
- Create: `packages/domain/src/policies/policies.test.ts`
- Update: `packages/domain/src/index.ts`
- Update: `packages/domain/package.json`
- Update: `pnpm-lock.yaml`

- [x] **Step 1: Write boundary-first failing tests**

Cover UUID parsing, UTC serialization, safe integer durations, `1 <= threshold <= activeContacts`, check-in deadline calculation, grace period calculation, second release delay, and exact-boundary behavior (`now === deadline` is due). Use table-driven tests for DST dates to prove calculations are instant-based.

Public contracts:

```ts
export type Instant = string & { readonly __brand: "Instant" };
export type AggregateId = string & { readonly __brand: "AggregateId" };

export function computeCheckinDeadline(lastCheckIn: Instant, intervalDays: number): Instant;
export function computeGraceDeadline(checkinDeadline: Instant, graceDays: number): Instant;
export function computeReleaseDeadline(triggeredAt: Instant, delayDays: number): Instant;
export function validateThreshold(threshold: number, activeContacts: number): void;
```

- [x] **Step 2: Observe the failure**

```powershell
pnpm.cmd --filter @dls/domain test -- policies.test.ts
```

- [x] **Step 3: Implement pure value objects**

Use Temporal only behind `instant.ts`; the rest of the domain operates on branded ISO strings. Generate UUIDv7 through an injected `IdGenerator` in application code, never directly in aggregates.

- [x] **Step 4: Verify and commit**

```powershell
pnpm.cmd --filter @dls/domain test
git add packages/domain
git commit -m "feat: add domain value objects and policies"
```

---

### Task 2: Implement explicit workflow state machines

**Files:**
- Create: `packages/domain/src/workflows/workflow-state.ts`
- Create: `packages/domain/src/workflows/death-workflow.ts`
- Create: `packages/domain/src/workflows/recovery-workflow.ts`
- Create: `packages/domain/src/workflows/release-workflow.ts`
- Create: `packages/domain/src/workflows/workflow-events.ts`
- Create: `packages/domain/src/workflows/workflow-transitions.test.ts`
- Create: `packages/domain/src/contacts/contact-lifecycle.ts`
- Create: `packages/domain/src/vault/share-generation-lifecycle.ts`
- Update: `packages/domain/src/index.ts`

- [x] **Step 1: Specify failing transition matrices**

Tests enumerate every allowed and rejected transition for:

- contact: `INVITED -> CONSENTED -> ACTIVE -> REMOVED` plus invitation expiry;
- share generation: `DRAFT -> DISTRIBUTING -> ACTIVE -> SUPERSEDED | FAILED`;
- death workflow: `AWAITING_CONFIRMATIONS -> GRACE_PERIOD -> RELEASE_PENDING -> RELEASED`, with `CANCELLED` from every pre-release state;
- recovery workflow: `AWAITING_APPROVALS -> REWRAP_PENDING -> COMPLETED | CANCELLED | EXPIRED`;
- package: `UPLOADING -> VALIDATING -> READY -> ACTIVE -> SUPERSEDED`, with `FAILED`/`ABORTED` before activation.

Each transition returns events and a new immutable snapshot:

```ts
export type TransitionResult<S, E> = Readonly<{ state: S; events: readonly E[] }>;
export function transitionDeathWorkflow(state: DeathWorkflow, command: DeathCommand, at: Instant): TransitionResult<DeathWorkflow, DomainEvent>;
```

- [x] **Step 2: Run and observe missing state machine failures**

```powershell
pnpm.cmd --filter @dls/domain test -- workflow-transitions.test.ts
```

- [x] **Step 3: Implement total transition functions**

Reject stale aggregate versions, repeated actor actions, threshold changes during a workflow, and transitions after terminal states. Snapshot the active contact IDs, thresholds, package version, and share generation at workflow creation.

- [x] **Step 4: Mutation-style transition coverage**

Add tests that flip every comparison boundary and assert the suite fails before restoring. Require 100% branch coverage for `packages/domain/src/workflows/**` and `packages/domain/src/policies/**`.

- [x] **Step 5: Commit state machines**

```powershell
pnpm.cmd --filter @dls/domain test --coverage
git add packages/domain
git commit -m "feat: implement workflow state machines"
```

---

### Task 3: Build the SQL migration runner and production schema

**Files:**
- Create: `packages/persistence/src/migrations/runner.ts`
- Create: `packages/persistence/src/migrations/runner.test.ts`
- Create: `packages/persistence/migrations/001_extensions_and_schemas.up.sql`
- Create: `packages/persistence/migrations/001_extensions_and_schemas.down.sql`
- Create: `packages/persistence/migrations/002_identity_contacts.up.sql`
- Create: `packages/persistence/migrations/002_identity_contacts.down.sql`
- Create: `packages/persistence/migrations/003_vault_packages.up.sql`
- Create: `packages/persistence/migrations/003_vault_packages.down.sql`
- Create: `packages/persistence/migrations/004_workflows_sessions.up.sql`
- Create: `packages/persistence/migrations/004_workflows_sessions.down.sql`
- Create: `packages/persistence/migrations/005_notifications_audit_publication.up.sql`
- Create: `packages/persistence/migrations/005_notifications_audit_publication.down.sql`
- Create: `packages/persistence/migrations/006_constraints_indexes_privileges.up.sql`
- Create: `packages/persistence/migrations/006_constraints_indexes_privileges.down.sql`
- Create: `packages/persistence/src/testing/postgres-container.ts`
- Create: `tests/integration/migrations.test.ts`
- Update: `packages/persistence/package.json`
- Update: `pnpm-lock.yaml`

- [x] **Step 1: Write a failing migration inventory test**

The test extracts the required tables from `docs/03-database-design.md` and asserts they exist after migration: `owner_profile`, `owner_credentials`, `system_settings`, `emergency_contacts`, `contact_invitations`, `contact_consents`, `vaults`, `share_generations`, `contact_key_shares`, `legacy_packages`, `check_ins`, `checkin_schedules`, `workflows`, `workflow_contacts`, `workflow_contact_actions`, `workflow_key_fragments`, `release_secret_sessions`, `password_rewrap_sessions`, `auth_sessions`, `one_time_tokens`, `email_verification_codes`, `notifications`, `notification_attempts`, `domain_outbox`, `publications`, `email_template_overrides`, `rate_limit_buckets`, plus `audit.private_events` and `audit.public_events`.

- [x] **Step 2: Run against a blank PostgreSQL 18.4 container**

```powershell
pnpm.cmd exec vitest run tests/integration/migrations.test.ts
```

Expected: failure because the migration table and schema do not exist.

- [x] **Step 3: Implement the locked runner**

Use a PostgreSQL advisory lock, checksum every migration, reject edited applied migrations, apply each file in one transaction, and record version/checksum/Beijing-observed timestamp in `infra.schema_migrations` while retaining database `timestamptz`. Support `up`, `down --steps 1`, and `status` CLI commands.

- [x] **Step 4: Implement constraints and least-privilege roles**

Verify the API, worker, migrator, backup, and read-only health login-role shells created by `ops/postgres/init/001-roles.sh`, then grant only their documented schema/table/sequence/function privileges. Enforce singleton owner, unique active workflows, legal enum transitions, nonnegative counters, threshold bounds, immutable audit rows, token digest uniqueness, package/version uniqueness, and documented partial indexes. Revoke public schema privileges. Do not create production test-mode tables in the default schema.

- [x] **Step 5: Rehearse up/down/up and commit**

```powershell
pnpm.cmd --filter @dls/persistence migrate:up
pnpm.cmd --filter @dls/persistence migrate:down -- --steps 1
pnpm.cmd --filter @dls/persistence migrate:up
pnpm.cmd exec vitest run tests/integration/migrations.test.ts
git add packages/persistence tests/integration/migrations.test.ts
git commit -m "feat: add postgres schema and migrations"
```

---

### Task 4: Implement transactions, repositories, idempotency, and outbox

**Files:**
- Create: `packages/application/src/ports/transaction-manager.ts`
- Create: `packages/application/src/ports/repositories.ts`
- Create: `packages/application/src/ports/database-clock.ts`
- Create: `packages/application/src/ports/outbox.ts`
- Create: `packages/application/src/ports/audit.ts`
- Create: `packages/persistence/src/postgres/pg-pool.ts`
- Create: `packages/persistence/src/postgres/pg-transaction-manager.ts`
- Create: `packages/persistence/src/postgres/pg-repositories.ts`
- Create: `packages/persistence/src/postgres/pg-database-clock.ts`
- Create: `packages/persistence/src/postgres/pg-outbox.ts`
- Create: `packages/persistence/src/postgres/idempotency.ts`
- Create: `tests/integration/repositories.test.ts`

- [x] **Step 1: Write failing repository contract tests**

Define and test this transaction shape:

```ts
export interface TransactionContext {
  readonly repositories: Repositories;
  readonly clock: DatabaseClock;
  readonly outbox: OutboxWriter;
  readonly audit: AuditWriter;
}

export interface TransactionManager {
  run<T>(work: (tx: TransactionContext) => Promise<T>, options?: { isolation?: "read committed" | "serializable" }): Promise<T>;
}
```

Contract tests cover rollback, nested-call rejection, version-checked updates, `SELECT ... FOR UPDATE`, mapper round trips, unique violation mapping, and atomically inserted aggregate plus outbox event.

- [x] **Step 2: Run and observe failures**

```powershell
pnpm.cmd exec vitest run tests/integration/repositories.test.ts
```

- [x] **Step 3: Implement explicit SQL repositories**

Use parameterized statements only. Repository methods accept the transaction client; they cannot silently use the global pool. Optimistic updates include `WHERE id=$1 AND version=$2` and increment version. Map database errors to stable application error codes without leaking SQL.

- [x] **Step 4: Implement idempotency storage**

Add a documented `app.idempotency_records` table via migration `007_idempotency`. Store actor scope, route/command name, key digest, canonical request hash, status, and response body/hash. Same key+request returns the stored response; same key+different request returns `IDEMPOTENCY_CONFLICT`.

- [x] **Step 5: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/repositories.test.ts
git add packages/application packages/persistence tests/integration/repositories.test.ts
git commit -m "feat: add transactional repositories and outbox"
```

---

### Task 5: Implement tamper-evident audit persistence

**Files:**
- Create: `packages/application/src/audit/canonical-event.ts`
- Create: `packages/application/src/audit/canonical-event.test.ts`
- Create: `packages/persistence/src/audit/pg-audit-writer.ts`
- Create: `packages/persistence/src/audit/audit-verifier.ts`
- Create: `packages/persistence/src/audit/audit-verifier.test.ts`
- Create: `packages/persistence/src/cli/verify-audit.ts`

- [x] **Step 1: Write failing canonicalization and chain tests**

Canonical bytes are UTF-8 RFC 8785-style sorted JSON of `sequence`, `occurredAt`, `eventType`, `actorType`, `actorIdDigest`, `aggregateType`, `aggregateId`, `payload`, and `previousHash`. Hash with SHA-256. Tests cover key-order independence, Unicode normalization policy, one-bit tampering, missing sequence, duplicate sequence, and independent private/public chains.

- [x] **Step 2: Implement append-only audit writes**

Serialize chain append by locking a per-stream head row. Database triggers reject update/delete for API and worker roles. Public-event projection uses an allowlist and redacts identifiers/payloads before hashing; private event contents never copy automatically into the public chain.

- [x] **Step 3: Verify the CLI**

```powershell
pnpm.cmd --filter @dls/persistence audit:verify -- --stream private
pnpm.cmd --filter @dls/persistence audit:verify -- --stream public
pnpm.cmd --filter @dls/persistence test -- audit
```

- [x] **Step 4: Commit audit chain**

```powershell
git add packages/application/src/audit packages/persistence/src/audit packages/persistence/src/cli
git commit -m "feat: persist tamper evident audit chains"
```

---

### Task 6: Implement pg-boss scheduling and outbox dispatch

**Files:**
- Create: `packages/application/src/ports/job-scheduler.ts`
- Create: `packages/persistence/src/jobs/job-names.ts`
- Create: `packages/persistence/src/jobs/pg-boss-scheduler.ts`
- Create: `packages/persistence/src/jobs/outbox-dispatcher.ts`
- Create: `packages/persistence/src/jobs/reconciliation.ts`
- Create: `apps/worker/src/jobs/register-handlers.ts`
- Create: `tests/integration/jobs.test.ts`
- Update: `packages/persistence/package.json`
- Update: `apps/worker/package.json`
- Update: `pnpm-lock.yaml`

- [x] **Step 1: Write failing retry and deduplication tests**

Assert one logical job for `(jobName, aggregateId, aggregateVersion)`, at-least-once handler invocation, exponential retry with bounded jitter, dead-letter metadata after configured attempts, restart recovery, and no outbox loss when a worker crashes after external work but before acknowledgement.

- [x] **Step 2: Implement scheduler and dispatcher**

Use names `checkin.evaluate`, `workflow.advance`, `notification.deliver`, `package.validate`, `publication.finalize`, `outbox.dispatch`, and `reconciliation.scan`. Job payloads contain IDs and expected versions, never secrets or full domain payloads. Handlers reload state and are no-ops when the expected version/state no longer matches.

- [x] **Step 3: Verify crash recovery**

```powershell
pnpm.cmd exec vitest run tests/integration/jobs.test.ts
docker compose restart worker
pnpm.cmd exec vitest run tests/integration/jobs.test.ts -t "restart recovery"
```

- [x] **Step 4: Commit job infrastructure**

```powershell
git add packages/application/src/ports packages/persistence/src/jobs apps/worker/src/jobs tests/integration/jobs.test.ts
git commit -m "feat: add durable job and outbox dispatch"
```

---

### Task 7: Prove transaction concurrency invariants

**Files:**
- Create: `tests/concurrency/affirmation-race.test.ts`
- Create: `tests/concurrency/alive-cancel-race.test.ts`
- Create: `tests/concurrency/release-cancel-race.test.ts`
- Create: `tests/concurrency/share-activation-race.test.ts`
- Create: `docs/acceptance/02-domain-persistence.md`

- [ ] **Step 1: Add simultaneous-client tests**

Use at least 20 synchronized database clients per case. Assert exactly one threshold transition, one outbox event per resulting version, one active share generation, no counter under/overflow, and a deterministic winner between release and cancellation based on row-lock acquisition plus current persisted state.

- [ ] **Step 2: Run each test repeatedly**

```powershell
1..20 | ForEach-Object { pnpm.cmd exec vitest run tests/concurrency --no-file-parallelism; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
pnpm.cmd --filter @dls/persistence migrate:down -- --steps 1
pnpm.cmd --filter @dls/persistence migrate:up
```

- [ ] **Step 3: Record and commit evidence**

`docs/acceptance/02-domain-persistence.md` records PostgreSQL version, isolation decisions, repetitions, and Beijing timestamps.

```powershell
git add tests/concurrency docs/acceptance/02-domain-persistence.md
git commit -m "test: prove persistence concurrency invariants"
```
