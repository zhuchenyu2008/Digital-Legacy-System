# Identity, Check-in, and Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the singleton-owner setup, secure sessions, daily check-in, owner settings and password rotation, contact invitation/consent/authentication, contact key lifecycle, and atomic share-generation activation required to arm the system.

**Architecture:** NestJS feature modules translate strict HTTP DTOs into application commands. Authentication and business authorization are separate. Sessions are opaque server-side records in PostgreSQL; CSRF, origin, rate, version, and idempotency checks happen before command execution. Browser crypto creates/unwraps key material, while the API validates envelopes/commitments and stores ciphertext only.

**Tech Stack:** NestJS/Fastify, Zod 4.4.3, native argon2 0.45.1, `@fastify/cookie` 11.1.2, PostgreSQL, libsodium browser facade, Vitest, Supertest/Fastify inject, Mailpit fixtures.

## Global Constraints

- Implement the exact request/response/error contracts in sections 2–7 and 18–19 of `docs/04-api-design.md`; regenerate OpenAPI after every controller task.
- The owner and contacts have different session types, cookie names, routes, authorization guards, idle/absolute TTLs, and rate-limit buckets.
- Login success rotates the session ID. Password change/recovery revokes every prior session and one-time token for that actor.
- Owner login performs a check-in in the same database transaction. Invalid login never alters check-in time or schedule.
- Email tokens are random 256-bit values stored only as peppered digests. Browser entry routes receive token material in the URL fragment, then POST it in a body; access logs never receive it.
- Contact acceptance is not activation. New/changed contacts become active only with a complete new death and recovery share generation produced by the owner browser.

---

### Task 1: Add HTTP security, sessions, CSRF, and stable errors

**Files:**
- Create: `packages/application/src/auth/session.ts`
- Create: `packages/application/src/auth/session-service.ts`
- Create: `packages/application/src/auth/session-service.test.ts`
- Create: `apps/api/src/security/session.guard.ts`
- Create: `apps/api/src/security/csrf.guard.ts`
- Create: `apps/api/src/security/origin.guard.ts`
- Create: `apps/api/src/security/rate-limit.guard.ts`
- Create: `apps/api/src/security/request-context.ts`
- Create: `apps/api/src/security/error.filter.ts`
- Create: `apps/api/src/security/security.module.ts`
- Create: `tests/integration/http-security.test.ts`

- [x] **Step 1: Write failing HTTP security tests**

Cover absent/expired/revoked/wrong-role sessions, fixation, concurrent session limits, cookie attributes, missing/wrong CSRF, bad/missing Origin on unsafe methods, reverse-proxy IP handling, request ID validation, JSON/body limits, and stable error envelope:

```json
{"error":{"code":"CSRF_INVALID","message":"请求无法验证","requestId":"018f28a8-7f9a-7b32-9e41-4454f1c75691","details":null}}
```

Ensure 401/403/404 behavior does not reveal whether a contact/email/token exists.

- [x] **Step 2: Run and observe failures**

```powershell
pnpm.cmd exec vitest run tests/integration/http-security.test.ts
```

- [x] **Step 3: Implement server-side sessions**

Use opaque 256-bit cookie values and store only SHA-256+pepper digests. Owner cookie is `__Host-dls-owner`; contact cookie is `__Host-dls-contact`. Production cookies are `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no Domain. Local HTTP development uses separate non-`__Host-` names configured explicitly and health warns that secure-cookie guarantees are reduced.

- [x] **Step 4: Implement CSRF/origin/rate controls**

Use a per-session synchronizer CSRF token returned only from `/api/v1/session`, sent in `X-CSRF-Token`; verify exact allowed Origin for unsafe methods. Persist rate buckets atomically for login, setup, invitations, recovery, verification codes, uploads, contact actions, and public downloads. Return generic `429` with bounded `Retry-After`.

- [x] **Step 5: Verify log redaction and commit**

Tests capture structured logs and assert cookie, authorization, CSRF, password, token, code, encrypted private key, share, and request-body sensitive fields are absent.

```powershell
pnpm.cmd exec vitest run tests/integration/http-security.test.ts
git add packages/application/src/auth apps/api/src/security tests/integration/http-security.test.ts
git commit -m "feat: secure sessions and http request boundaries"
```

---

### Task 2: Implement one-time singleton owner setup

**Files:**
- Create: `packages/application/src/setup/get-setup-status.ts`
- Create: `packages/application/src/setup/create-owner.ts`
- Create: `packages/application/src/setup/create-owner.test.ts`
- Create: `apps/api/src/setup/setup.controller.ts`
- Create: `apps/api/src/setup/setup.dto.ts`
- Create: `apps/api/src/setup/setup.module.ts`
- Create: `tests/integration/setup.test.ts`

- [x] **Step 1: Write failing setup contract tests**

Cover blank database, valid owner creation, duplicate/concurrent creation, invalid bootstrap secret, expired setup window, weak/too-long password, email normalization collision, invalid wrapped VK/commitment/KDF profile, crash rollback, and post-setup endpoint disablement.

`POST /api/v1/setup/owner` requires a setup secret in the body and accepts owner profile, server authentication password, client KDF profile, wrapped VK, and VK commitment. It returns an owner session but never echoes password/key material.

- [x] **Step 2: Implement setup atomically**

Hash the owner password with the server-only pepper. Validate the browser wrapping with schemas and lengths without decrypting it. Insert owner/profile/credentials/vault/default settings/initial check-in schedule/audit/outbox and consume setup capability in one serializable transaction. Singleton constraints arbitrate races.

- [x] **Step 3: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/setup.test.ts
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
git add packages/application/src/setup apps/api/src/setup tests/integration/setup.test.ts packages/contracts
git commit -m "feat: create singleton owner setup"
```

---

### Task 3: Implement owner login, check-in, settings, and normal password change

**Files:**
- Create: `packages/application/src/owner/login-owner.ts`
- Create: `packages/application/src/owner/check-in.ts`
- Create: `packages/application/src/owner/get-owner-session.ts`
- Create: `packages/application/src/owner/update-settings.ts`
- Create: `packages/application/src/owner/change-owner-password.ts`
- Create: `packages/application/src/owner/owner-use-cases.test.ts`
- Create: `apps/api/src/owner/owner-auth.controller.ts`
- Create: `apps/api/src/owner/owner.controller.ts`
- Create: `apps/api/src/owner/owner.dto.ts`
- Create: `apps/api/src/owner/owner.module.ts`
- Create: `tests/integration/owner-checkin.test.ts`

- [x] **Step 1: Write failing owner behavior tests**

Test login+check-in atomicity, explicit check-in, identical-day repeat, exact deadlines, schedule versioning, failed-login nonmutation, revoked session, optimistic settings update, legal threshold ranges, settings locked during workflow, old-password verification, VK commitment consistency, and password rewrap rollback.

- [x] **Step 2: Implement login and check-in transaction**

Verify Argon2id, lock owner/schedule, read database time once, append `check_ins`, compute the next deadline, cancel only workflow states the approved policy allows, rotate session, audit, and enqueue schedule reconciliation in one transaction. Authentication response returns wrapped VK and KDF profile only to the authenticated owner session.

- [x] **Step 3: Implement settings and password change**

Require owner password reauthentication for email, thresholds, timing, SMTP, and password changes. Browser submits old-wrapped/new-wrapped VK plus new KDF profile and unchanged commitment. Server verifies old password and new server hash, swaps credentials/wrapping atomically, revokes all sessions/tokens, then creates one fresh session.

- [x] **Step 4: Verify concurrent check-ins**

```powershell
pnpm.cmd exec vitest run tests/integration/owner-checkin.test.ts
pnpm.cmd exec vitest run tests/integration/owner-checkin.test.ts -t "concurrent"
pnpm.cmd openapi:generate
```

Assert simultaneous login/check-in requests cannot regress a deadline or duplicate a workflow-cancellation event.

- [x] **Step 5: Commit owner lifecycle**

```powershell
pnpm.cmd openapi:check
git add packages/application/src/owner apps/api/src/owner tests/integration/owner-checkin.test.ts packages/contracts
git commit -m "feat: add owner authentication and check in"
```

---

### Task 4: Implement contact invitation, consent, registration, and login

**Files:**
- Create: `packages/application/src/contacts/invite-contact.ts`
- Create: `packages/application/src/contacts/view-invitation.ts`
- Create: `packages/application/src/contacts/accept-invitation.ts`
- Create: `packages/application/src/contacts/login-contact.ts`
- Create: `packages/application/src/contacts/contact-use-cases.test.ts`
- Create: `apps/api/src/contacts/contact-invitations.controller.ts`
- Create: `apps/api/src/contacts/contact-auth.controller.ts`
- Create: `apps/api/src/contacts/contact.dto.ts`
- Create: `apps/api/src/contacts/contact.module.ts`
- Create: `tests/integration/contact-invitation.test.ts`

- [ ] **Step 1: Write failing invitation and consent tests**

Cover create/resend/expire/consume, same-email collision, max contacts, no account enumeration, exact consent-version capture, checkbox/version mismatch, contact password limits, mismatched CPK/CSK wrapper lengths, replay, concurrent acceptance, and token absence from URL/access log.

Acceptance input contains invitation token in JSON body, explicit current consent document version, contact password for server authentication, contact client KDF profile, X25519 public key, and encrypted private-key wrapper.

- [ ] **Step 2: Implement token and consent persistence**

Generate tokens through an injected CSPRNG, store peppered digests, use one-time row locks, and expire by database time. Store consent document version, digest, accepted timestamp, IP digest, and user-agent digest; never store raw token.

- [ ] **Step 3: Implement contact authentication**

Hash contact passwords separately from owner passwords and scope rate limits by account digest plus IP. On login return contact session and wrapped CSK/KDF/CPK only; sealed shares remain behind the authenticated cryptographic-material endpoint.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/contact-invitation.test.ts
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
git add packages/application/src/contacts apps/api/src/contacts tests/integration/contact-invitation.test.ts packages/contracts
git commit -m "feat: invite and register emergency contacts"
```

---

### Task 5: Implement contact password rotation and removal

**Files:**
- Create: `packages/application/src/contacts/request-password-change.ts`
- Create: `packages/application/src/contacts/change-contact-password.ts`
- Create: `packages/application/src/contacts/remove-contact.ts`
- Create: `packages/application/src/contacts/get-crypto-material.ts`
- Create: `packages/application/src/contacts/contact-security.test.ts`
- Update: `apps/api/src/contacts/contact-auth.controller.ts`
- Update: `apps/api/src/contacts/contact-invitations.controller.ts`
- Create: `tests/integration/contact-security.test.ts`

- [ ] **Step 1: Write failing rotation/removal tests**

Password change must prove current contact session or one-time email flow, verify old credential where applicable, keep CPK unchanged, accept a newly wrapped CSK, revoke all old sessions/tokens, and leave existing sealed shares decryptable. Removal requires owner password reauthentication and is rejected if it would violate configured minimums or an active workflow snapshot.

- [ ] **Step 2: Implement contact security flows**

Removing a contact marks it removed, revokes access, supersedes active share generation eligibility, and puts the system into `CONFIGURING` until a new generation activates. Never delete historical consent/action/audit evidence.

- [ ] **Step 3: Verify old/new material semantics**

```powershell
pnpm.cmd exec vitest run tests/integration/contact-security.test.ts
pnpm.cmd --filter @dls/crypto test -t "contact password"
```

- [ ] **Step 4: Commit contact security**

```powershell
git add packages/application/src/contacts apps/api/src/contacts tests/integration/contact-security.test.ts
git commit -m "feat: rotate and revoke contact access"
```

---

### Task 6: Generate, distribute, and activate share generations

**Files:**
- Create: `packages/application/src/shares/create-generation.ts`
- Create: `packages/application/src/shares/upload-generation.ts`
- Create: `packages/application/src/shares/activate-generation.ts`
- Create: `packages/application/src/shares/get-generation-material.ts`
- Create: `packages/application/src/shares/share-generation.test.ts`
- Create: `apps/api/src/shares/share-generation.controller.ts`
- Create: `apps/api/src/shares/share-generation.dto.ts`
- Create: `apps/api/src/shares/share-generation.module.ts`
- Create: `tests/integration/share-generation.test.ts`

- [ ] **Step 1: Write failing generation validation tests**

Test exact active-contact snapshot, sequential share indexes, unique contact envelopes, separate death/recovery commitment sets, threshold formulas (`ceil(N*0.70)` and `floor(N/2)+1`), VK commitment match, purpose/context binding, stale roster/version, missing/extra/duplicate contact, invalid commitment/share proof, retry, and concurrent activation.

- [ ] **Step 2: Implement two-phase generation**

Owner starts a `DRAFT` with roster and vault version. Browser unwraps VK, creates both Pedersen generations, sealed-box encrypts one share per active CPK, and uploads commitments/envelopes. API verifies structural/context/commitment proofs without learning share plaintext, then marks `DISTRIBUTING`.

- [ ] **Step 3: Implement atomic activation and arming gate**

Lock vault/settings/contact roster/current generation. Revalidate all snapshots and package readiness; activate both purpose sets under one generation ID, supersede prior generation, and emit audit/outbox. The system becomes `ARMED` only when owner profile, >=3 active contacts, active package with `will.md` preflight metadata, tested SMTP, current share generation, and irreversible-release acknowledgement are all present.

- [ ] **Step 4: Verify old-generation rejection**

```powershell
pnpm.cmd exec vitest run tests/integration/share-generation.test.ts
pnpm.cmd exec vitest run tests/concurrency/share-activation-race.test.ts
pnpm.cmd test:crypto
```

- [ ] **Step 5: Commit share activation**

```powershell
git add packages/application/src/shares apps/api/src/shares tests/integration/share-generation.test.ts
git commit -m "feat: activate verifiable share generations"
```

---

### Task 7: Run the identity/contact exit gate

**Files:**
- Create: `docs/acceptance/04-identity-checkin-contacts.md`

- [ ] **Step 1: Run all focused and contract gates**

```powershell
pnpm.cmd test:unit
pnpm.cmd test:integration
pnpm.cmd test:crypto
pnpm.cmd openapi:check
pnpm.cmd build
```

- [ ] **Step 2: Record evidence**

Record setup race, login/check-in atomicity, password rotations, consent version, fragment token behavior, contact removal, share generation, system arming, log-redaction scan, and Beijing timestamps.

- [ ] **Step 3: Commit evidence**

```powershell
git add docs/acceptance/04-identity-checkin-contacts.md
git commit -m "test: record identity and contact acceptance"
```
