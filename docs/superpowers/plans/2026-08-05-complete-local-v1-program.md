# Digital Legacy System Complete Local V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved complete local V1 as a real, testable system: owner and contact identities, encrypted vault, verifiable share workflow, check-ins, recovery, release/publication, notifications, simulations, audit evidence, and Docker-based operations.

**Architecture:** A pnpm TypeScript modular monolith contains a Next.js web app, NestJS Fastify API, NestJS worker, explicit domain/application packages, PostgreSQL plus pg-boss, and pluggable storage. Browser-side cryptography uses libsodium and a pinned Rust/WASM VSS implementation; server authentication uses native Argon2id. Docker Compose is the canonical Windows development and Linux deployment path. Filesystem volumes are the default object store; S3 is an optional adapter and Compose profile.

**Tech Stack:** Node.js 24.18.0 LTS, pnpm 11.20.0, TypeScript 6.0.3, Next.js 16.3.0, React 19.2.8, NestJS 11.1.28, Fastify 5.11.2, PostgreSQL 18.4, pg-boss 12.27.0, Rust 1.97.1, vsss-rs 5.4.0, wasm-bindgen 0.2.126, libsodium-wrappers-sumo 0.8.4, Caddy 2.11.4, Mailpit 1.30.6, optional MinIO `RELEASE.2025-10-15T17-29-55Z`, Vitest 4.1.10, Playwright 1.62.1, Docker Compose.

## Global Constraints

- Execute the seven work-package plans in numeric order. A package may only start after the previous package's final verification command passes.
- Follow red-green-refactor for every behavior. Never write application code before observing the named test fail for the expected reason.
- Use database time for persisted deadlines and transition decisions. Injectable clocks are allowed only in pure domain tests and isolated simulation namespaces.
- Passwords, derived keys, decrypted DEKs, plaintext files, recovery shares, and contact private keys must never enter logs, telemetry, URLs, server-rendered HTML, or PostgreSQL plaintext columns.
- Pages handling passwords, private keys, shares, or plaintext vault content may not load third-party runtime JavaScript. Google Fonts and static icon/font CDN assets require local fallbacks and a restrictive CSP.
- Default storage is `filesystem`; `s3` is optional. Both adapters must pass the same storage contract, range, immutability, checksum, and failure-injection suite.
- Production release remains blocked until an independent cryptographic review, legal review, backup-restore rehearsal, and manual penetration test are recorded. Local automated gates prove implementation behavior, not external assurance.
- Every commit listed below is scoped to its task. Do not include the user's pre-existing documentation changes unless the user explicitly asks to commit them.

## Work Package Order

| Order | Plan | Exit evidence |
|---:|---|---|
| 1 | [Foundation and infrastructure](./2026-08-05-01-foundation-infrastructure.md) | Pinned workspace, booting containers, health checks, generated OpenAPI client |
| 2 | [Domain and persistence](./2026-08-05-02-domain-persistence.md) | State machines, SQL schema, transaction/outbox, jobs, concurrency tests |
| 3 | [Cryptography, vault, storage](./2026-08-05-03-cryptography-vault-storage.md) | Cross-runtime vectors, VSS, envelopes, both storage adapters, encrypted packages |
| 4 | [Identity, check-in, contacts](./2026-08-05-04-identity-checkin-contacts.md) | Setup/auth, contact consent, check-in, share activation, password rotation |
| 5 | [Workflows, notifications, publication](./2026-08-05-05-workflows-notification-publication.md) | Death/recovery/release workflows, retries, audit chain, safe publication |
| 6 | [Web and email experience](./2026-08-05-06-web-email-ui.md) | High-fidelity responsive screens and mail, accessibility and visual baselines |
| 7 | [Simulation, E2E, operations](./2026-08-05-07-simulation-e2e-operations.md) | Full browser journeys, security/fault gates, Windows/Linux deployment runbooks |

## Fixed Package Boundaries

```text
apps/web                  Next.js UI and browser-only adapters
apps/api                  HTTP composition root and request security
apps/worker               pg-boss consumers and scheduled reconciliation
packages/domain           Pure entities, value objects, policies, state machines
packages/application      Use cases, ports, transaction orchestration
packages/contracts        Zod DTOs, OpenAPI helpers, generated client
packages/crypto           Versioned wire formats and browser/Node crypto facade
packages/vss-wasm         Rust VSS core and generated WASM bindings
packages/persistence      SQL migrations, pg repositories, outbox and audit chain
packages/storage          Filesystem and optional S3 adapters
packages/email-templates  Versioned subjects, text/HTML renderers
packages/test-fixtures    Builders, deterministic clocks, fake services, vectors
tests                     Cross-package, E2E, security, deployment and acceptance
ops                       Docker, Caddy, scripts, environment examples and runbooks
```

Dependencies point inward: apps and adapters may depend on application/domain/contracts; domain imports no framework, database, network, storage, or environment package. `packages/application` owns ports; persistence/storage/email packages implement them. Browser code imports only the browser export map of `packages/crypto`.

## Canonical Commands

From `D:\code\Digital-Legacy-System` on Windows PowerShell:

```powershell
corepack enable
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test:unit
pnpm.cmd test:integration
pnpm.cmd test:crypto
pnpm.cmd test:e2e
pnpm.cmd test:security
pnpm.cmd test:storage
pnpm.cmd test:deployment
pnpm.cmd build
pnpm.cmd acceptance
```

`pnpm.cmd acceptance` is the single local release gate. It must run format/lint/type checks, unit/integration/crypto/storage/E2E/security/deployment tests, OpenAPI and generated-client drift checks, production builds, migration up/down/up rehearsal, backup/restore rehearsal, and audit-chain verification. It exits nonzero on skipped required suites or missing evidence files.

## Global Done Definition

- [ ] Every checkbox in all seven work-package plans is checked and every listed commit exists.
- [ ] `pnpm-lock.yaml` and `Cargo.lock` are committed; CI uses frozen/locked dependency resolution.
- [ ] `docker compose --profile test up --build --abort-on-container-exit acceptance` exits 0 on Docker Desktop and on a Linux CI runner.
- [ ] Default Compose starts without MinIO or cloud credentials and persists private/public objects in named volumes.
- [ ] `docker compose --profile s3 --profile test ...` runs the same storage suite against MinIO.
- [ ] No browser request containing a password, key, share, decrypted file, or fragment secret reaches the API logs or access logs.
- [ ] Crash injection at every release/publication boundary converges through idempotent retry without duplicate notifications or partially public metadata.
- [ ] The visual regression manifest covers every approved page state at 1440×900 and 390×844, and axe reports no serious/critical violations.
- [ ] Restore into a blank PostgreSQL database plus blank object volume reproduces checksums and passes the public/audit consistency verifier.
- [ ] `docs/acceptance/local-v1-evidence.md` records exact versions, commands, Beijing timestamps, results, known external blockers, and artifact hashes.
