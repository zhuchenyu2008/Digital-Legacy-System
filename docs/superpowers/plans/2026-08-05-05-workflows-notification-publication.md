# Workflows, Notifications, and Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement overdue detection, death confirmation, alive cancellation, release countdown and irreversible publication, threshold password recovery, reliable notifications, private/public audit projections, and safe public download behavior.

**Architecture:** API commands persist decisions; purpose-specific sealed ingress keeps release share plaintext away from the API. Worker processes death-release fragments and final publication because only it can read release private/stage secrets. API processes recovery fragments because only it can read recovery private/stage secrets. Threshold results are stage-wrapped immediately, fragments are destroyed transactionally, and all later work is idempotent. Publication stages immutable public objects before committing the only database references that make them reachable.

**Tech Stack:** NestJS API/worker, PostgreSQL/pg-boss, libsodium, filesystem/S3 storage port, Nodemailer 9.0.4, Handlebars 4.7.9, Juice 12.1.2, Mailpit, yauzl/marked/sanitize-html, Vitest.

## Global Constraints

- Workflow snapshots freeze contacts, share generation, package version, thresholds, owner public data, and deadlines. Later configuration changes cannot alter a running workflow.
- Add purpose-specific X25519 ingress keys: API receives only release public key; worker receives release public/private keys. API receives recovery public/private keys; worker receives no recovery keys. Stage KEKs remain separate from ingress keys.
- Contact browsers decrypt their own sealed share and immediately seal it to the workflow's purpose-specific ingress public key. HTTP/log/job/database intermediaries see only a versioned sealed envelope.
- Worker alone unwraps death fragments and `RELEASE_STAGE_KEK`; API alone unwraps recovery fragments and `RECOVERY_STAGE_KEK`. Startup fails if a process has forbidden key material.
- A negative/alive decision cancels the death workflow under the documented policy and discloses only that contact's snapshotted name/email to the other snapshotted contacts.
- SMTP failure never blocks a state transition or final publication. It produces durable retry/dead-letter evidence.
- Once `publish_locked_at` is committed, normal application paths cannot cancel, update, delete, replace, or hide the publication.

---

### Task 1: Implement purpose-separated fragment ingress and stage wrapping

**Files:**
- Create: `packages/crypto/src/workflows/fragment-ingress.ts`
- Create: `packages/crypto/src/workflows/stage-wrapping.ts`
- Create: `packages/crypto/src/workflows/fragment-ingress.test.ts`
- Create: `packages/application/src/ports/stage-key-provider.ts`
- Create: `packages/application/src/workflows/submit-fragment.ts`
- Create: `packages/persistence/migrations/008_fragment_ingress.up.sql`
- Create: `packages/persistence/migrations/008_fragment_ingress.down.sql`
- Create: `apps/api/src/config/key-capabilities.ts`
- Create: `apps/worker/src/config/key-capabilities.ts`
- Create: `tests/integration/key-capabilities.test.ts`

- [ ] **Step 1: Write failing envelope and capability tests**

`FragmentIngressV1` binds workflow ID, contact ID, share generation, share index, purpose, commitment digest, ingress key version, nonce/ciphertext, and protocol version. Test cross-purpose/process/key/version replay, corruption, stale workflow, and mixed context.

Capability tests boot API and worker under valid and invalid secret mounts and assert:

- API: release ingress public; recovery ingress public/private; recovery stage KEK; no release private/stage KEK.
- Worker: release ingress public/private; release stage KEK; no recovery private/stage KEK.

- [ ] **Step 2: Add an explicit ingress lifecycle to the schema**

Migration adds `status = PENDING|VALIDATED|REJECTED|DESTROYED`, `ingress_key_version`, `stage_key_version`, `protocol_version`, and nullable ciphertext/nonce fields to fragment persistence. Pending rows are sealed-box envelopes; validated rows are immediately re-encrypted with the purpose stage KEK. Destroyed rows null all ciphertext/nonce fields. Constraints make each representation mutually exclusive.

- [ ] **Step 3: Implement unwrap/verify/rewrap**

After a process decrypts ingress material, validate Pedersen share/context against the snapshotted commitments, wrap it under the stage KEK, zero buffers, and update status in one locked transaction. Jobs contain only workflow/contact IDs.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm.cmd --filter @dls/crypto test -- fragment-ingress.test.ts
pnpm.cmd exec vitest run tests/integration/key-capabilities.test.ts
git add packages/crypto/src/workflows packages/application packages/persistence/migrations/008_fragment_ingress.* apps/api/src/config apps/worker/src/config tests/integration/key-capabilities.test.ts
git commit -m "feat: isolate workflow fragment key capabilities"
```

---

### Task 2: Detect overdue check-ins and start death workflows

**Files:**
- Create: `packages/application/src/workflows/evaluate-checkin.ts`
- Create: `packages/application/src/workflows/start-death-workflow.ts`
- Create: `packages/application/src/workflows/get-contact-workflow.ts`
- Create: `packages/application/src/workflows/get-owner-workflow.ts`
- Create: `packages/application/src/workflows/death-workflow.test.ts`
- Create: `apps/worker/src/jobs/checkin-evaluate.handler.ts`
- Create: `apps/api/src/workflows/workflows.controller.ts`
- Create: `apps/api/src/workflows/workflows.module.ts`
- Create: `apps/api/src/workflows/workflows.dto.ts`
- Create: `tests/integration/death-workflow-start.test.ts`

- [ ] **Step 1: Write failing deadline/start tests**

Cover not due, exact due, grace boundary, repeated scheduler runs, concurrent starts, not armed, active recovery cancellation, snapshotted roster/package/generation/thresholds, next-job scheduling, audit/outbox, and no secret data in job payload.

- [ ] **Step 2: Implement idempotent evaluation**

Lock schedule/owner/current workflows, fetch database time once, compare against persisted deadline, and create at most one active death workflow. If death confirmation starts, cancel/destroy any recovery flow in the same transaction and enqueue one invitation notification per snapshotted active contact.

- [ ] **Step 3: Expose scoped workflow queries**

Owner sees full private state. A contact sees only their participation state, aggregate counts, legal next actions, sealed share envelope, and purpose-specific ingress public key. No contact sees another contact's decision or identity except the documented alive-denial disclosure event.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/death-workflow-start.test.ts
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
git add packages/application/src/workflows apps/worker/src/jobs apps/api/src/workflows tests/integration/death-workflow-start.test.ts packages/contracts
git commit -m "feat: start overdue death confirmation workflows"
```

---

### Task 3: Process affirmative and alive contact decisions

**Files:**
- Create: `packages/application/src/workflows/affirm-death.ts`
- Create: `packages/application/src/workflows/confirm-alive.ts`
- Create: `packages/application/src/workflows/process-release-fragment.ts`
- Create: `apps/api/src/workflows/contact-actions.controller.ts`
- Create: `apps/worker/src/jobs/process-release-fragment.handler.ts`
- Create: `tests/integration/contact-decisions.test.ts`
- Create: `tests/concurrency/contact-decisions-race.test.ts`

- [ ] **Step 1: Write failing decision tests**

Require recent contact password reauthentication and exact no-paste confirmation text. Cover one decision per snapshot contact, idempotent replay, stale generation/purpose, invalid sealed fragment, confirmation-text digest, same-contact double submit, simultaneous threshold responses, alive vs affirmative race, and action after terminal state.

- [ ] **Step 2: Implement affirmative ingress**

API validates session, roster, state, confirmation text, envelope metadata, and request idempotency; it inserts a pending sealed ingress row and outbox only. Worker unwraps/validates/rewraps, locks workflow, records one action, recomputes count from action rows rather than trusting a client counter, and advances when the snapshotted threshold is met.

- [ ] **Step 3: Reconstruct and stage VK at threshold**

Worker decrypts exactly the required validated death shares, verifies each again, reconstructs VK, verifies `vkCommitment`, wraps VK with `RELEASE_STAGE_KEK`, writes `release_secret_sessions`, sets 24-hour `RELEASE_PENDING`, schedules reminders/finalization, and destroys every fragment in one transaction. Plaintext VK/share buffers are zeroed in `finally`.

- [ ] **Step 4: Implement alive cancellation**

API records the alive action under a workflow row lock, moves to `CANCELLED`, revokes pending tokens/jobs, destroys fragments/staged keys, reschedules check-in from database time per approved policy, and enqueues the narrowly disclosed cancellation email.

- [ ] **Step 5: Repeatedly verify concurrency and commit**

```powershell
1..20 | ForEach-Object { pnpm.cmd exec vitest run tests/concurrency/contact-decisions-race.test.ts --no-file-parallelism; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
pnpm.cmd exec vitest run tests/integration/contact-decisions.test.ts
git add packages/application/src/workflows apps/api/src/workflows apps/worker/src/jobs tests/integration/contact-decisions.test.ts tests/concurrency/contact-decisions-race.test.ts
git commit -m "feat: process contact workflow decisions"
```

---

### Task 4: Implement release countdown, owner cancellation, and publish lock

**Files:**
- Create: `packages/application/src/workflows/cancel-death-workflow.ts`
- Create: `packages/application/src/workflows/advance-release.ts`
- Create: `packages/application/src/workflows/release-countdown.test.ts`
- Create: `apps/api/src/workflows/owner-actions.controller.ts`
- Create: `apps/worker/src/jobs/workflow-advance.handler.ts`
- Create: `tests/concurrency/release-lock-race.test.ts`

- [ ] **Step 1: Write failing deadline/cancel race tests**

Cover cancellation with correct/incorrect MP, session-only rejection, deadline -1 ms/exact/+1 ms, duplicate workers, crash before/after lock, stale job, missing stage key, stage-key version mismatch, and 20 simultaneous cancellation/finalization requests.

- [ ] **Step 2: Implement owner cancellation before lock**

Verify current MP server-side, then lock workflow and fetch database time. Cancellation succeeds only if state is `RELEASE_PENDING`, deadline is still future, and `publish_locked_at IS NULL`. Destroy staged VK and jobs/tokens transactionally; return a stable terminal result on idempotent retry.

- [ ] **Step 3: Implement irreversible publish lock**

Worker uses a conditional locked update setting `publish_locked_at=clock_timestamp()` only when deadline is due and state remains eligible. After commit, no API/worker role has a mutation path back to a cancellable state. Missing stage keys produce a critical health condition and retry/dead-letter, never a fabricated cancellation or release.

- [ ] **Step 4: Verify and commit**

```powershell
1..20 | ForEach-Object { pnpm.cmd exec vitest run tests/concurrency/release-lock-race.test.ts --no-file-parallelism; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
git add packages/application/src/workflows apps/api/src/workflows apps/worker/src/jobs tests/concurrency/release-lock-race.test.ts
git commit -m "feat: lock irreversible release deadline"
```

---

### Task 5: Implement threshold owner-password recovery

**Files:**
- Create: `packages/application/src/recovery/request-recovery.ts`
- Create: `packages/application/src/recovery/start-recovery.ts`
- Create: `packages/application/src/recovery/approve-recovery.ts`
- Create: `packages/application/src/recovery/create-rewrap-session.ts`
- Create: `packages/application/src/recovery/complete-password-reset.ts`
- Create: `packages/application/src/recovery/expire-recovery.ts`
- Create: `apps/api/src/recovery/recovery.controller.ts`
- Create: `apps/api/src/recovery/recovery.dto.ts`
- Create: `apps/api/src/recovery/recovery.module.ts`
- Create: `tests/integration/password-recovery.test.ts`
- Create: `tests/concurrency/recovery-death-race.test.ts`

- [ ] **Step 1: Write failing complete recovery tests**

Cover generic request response, main-email-only start link, one active workflow, independent recovery generation/threshold, recent contact reauthentication, sealed recovery ingress, invalid/mixed shares, threshold reconstruction, primary-email-only 8-digit code, 5 attempts/10-minute expiry, 15-minute rewrap session, ephemeral X25519 key, sealed VK digest, one-time consumption, new wrapped VK commitment, new auth hash, and destruction on success/cancel/7-day expiry/death start.

- [ ] **Step 2: Implement recovery start and approvals**

Recovery never changes check-in deadlines. API unwraps recovery ingress with its private key, verifies/re-wraps using `RECOVERY_STAGE_KEK`, and on threshold reconstructs VK, verifies commitment, stage-wraps it, destroys fragments, and sends an 8-digit code only to the primary owner email.

- [ ] **Step 3: Implement one-time browser rewrap**

The browser creates an ephemeral X25519 key pair and POSTs its public key plus valid email link token and code. API returns VK sealed to that ephemeral public key and binds its digest to a 15-minute session. Browser derives a new OWNER_KEK and submits new wrapped VK/KDF plus new password. API verifies sealed digest/session/commitment, changes credentials atomically, revokes all old sessions/tokens, consumes the rewrap session, and destroys recovery staged material.

- [ ] **Step 4: Prove death workflow priority**

Synchronize recovery approval/complete with death start. Row locks and state conditions must yield exactly one allowed outcome; when death starts first, every recovery token/code/session/staged key is revoked/destroyed.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/password-recovery.test.ts
1..20 | ForEach-Object { pnpm.cmd exec vitest run tests/concurrency/recovery-death-race.test.ts --no-file-parallelism; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
git add packages/application/src/recovery apps/api/src/recovery tests/integration/password-recovery.test.ts tests/concurrency/recovery-death-race.test.ts packages/contracts
git commit -m "feat: recover owner password by contact threshold"
```

---

### Task 6: Deliver durable, privacy-safe notifications

**Files:**
- Create: `packages/application/src/ports/email-sender.ts`
- Create: `packages/application/src/ports/email-template-renderer.ts`
- Create: `packages/application/src/notifications/create-notification.ts`
- Create: `packages/application/src/notifications/deliver-notification.ts`
- Create: `packages/application/src/notifications/notification-policy.ts`
- Create: `packages/application/src/notifications/notifications.test.ts`
- Create: `apps/worker/src/email/nodemailer-sender.ts`
- Create: `apps/worker/src/jobs/notification-deliver.handler.ts`
- Create: `packages/email-templates/src/template-codes.ts`
- Create: `packages/email-templates/src/template-contracts.ts`
- Create: `packages/email-templates/src/render-template.ts`
- Create: `packages/email-templates/src/layouts/base.hbs`
- Create: `packages/email-templates/src/styles/email.css`
- Create: `packages/email-templates/src/templates/contact-invitation.hbs`, `packages/email-templates/src/text/contact-invitation.txt.hbs`
- Create: `packages/email-templates/src/templates/checkin-reminder.hbs`, `packages/email-templates/src/text/checkin-reminder.txt.hbs`
- Create: `packages/email-templates/src/templates/death-confirmation-request.hbs`, `packages/email-templates/src/text/death-confirmation-request.txt.hbs`
- Create: `packages/email-templates/src/templates/death-cancelled-by-contact.hbs`, `packages/email-templates/src/text/death-cancelled-by-contact.txt.hbs`
- Create: `packages/email-templates/src/templates/death-cancelled-by-owner.hbs`, `packages/email-templates/src/text/death-cancelled-by-owner.txt.hbs`
- Create: `packages/email-templates/src/templates/death-stage2-reminder.hbs`, `packages/email-templates/src/text/death-stage2-reminder.txt.hbs`
- Create: `packages/email-templates/src/templates/legacy-released.hbs`, `packages/email-templates/src/text/legacy-released.txt.hbs`
- Create: `packages/email-templates/src/templates/contact-password-change.hbs`, `packages/email-templates/src/text/contact-password-change.txt.hbs`
- Create: `packages/email-templates/src/templates/owner-recovery-start.hbs`, `packages/email-templates/src/text/owner-recovery-start.txt.hbs`
- Create: `packages/email-templates/src/templates/owner-recovery-contact-request.hbs`, `packages/email-templates/src/text/owner-recovery-contact-request.txt.hbs`
- Create: `packages/email-templates/src/templates/owner-password-reset.hbs`, `packages/email-templates/src/text/owner-password-reset.txt.hbs`
- Create: `packages/email-templates/src/render-template.test.ts`
- Create: `tests/integration/notifications-mailpit.test.ts`
- Update: `packages/email-templates/package.json`
- Update: `apps/worker/package.json`
- Update: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing semantic template tests**

Define all eleven PRD section 7 template codes and exact required placeholders. Reject missing/unknown placeholders, escape every value, forbid raw HTML/script/form/remote image/tracking pixel/attachment, emit a text equivalent, add a visible plain URL beside every action button, format times in Beijing, and snapshot the template version used by a notification. These are complete safe business templates; plan 6 refines their presentation against designs 14/15 without changing the contracts.

- [ ] **Step 2: Implement the renderer and application port**

`EmailTemplateRendererPort.render` returns `{ subject, html, text, templateCode, templateVersion }`. Use Handlebars strict mode, Juice for controlled inline CSS, a fixed sender identity, and declared context schemas. No template can access arbitrary object properties or call helpers other than escaping, Beijing time, and plain text formatting.

- [ ] **Step 3: Write failing notification state/retry tests**

Cover template/version snapshot, recipient snapshot encryption, one logical notification per event/recipient/template, SMTP accepted/rejected/timeout, retry schedule, sanitized error storage, dead letter, primary-to-backup fallback rules, no fallback for recovery, no duplicate delivery after restart, and release state independence.

- [ ] **Step 4: Implement sender and retry policy**

Nodemailer requires certificate-validated TLS in production and refuses plaintext downgrade. Worker renders through `EmailTemplateRendererPort`, strips CR/LF from headers, records normalized provider result, and never stores raw SMTP transcripts. Jobs reload notification state and use a stable message ID.

- [ ] **Step 5: Verify message privacy in Mailpit**

Assert no message body/header contains password, share, VK/DEK, ZIP attachment, will text, private audit payload, full roster, or action token outside the single intended fragment URL. Final release mail contains only public URL and public digests.

- [ ] **Step 6: Commit templates and notification engine**

```powershell
pnpm.cmd --filter @dls/email-templates test
pnpm.cmd exec vitest run tests/integration/notifications-mailpit.test.ts
git add packages/application/src/notifications packages/application/src/ports/email-sender.ts packages/application/src/ports/email-template-renderer.ts packages/email-templates apps/worker/src/email apps/worker/src/jobs/notification-deliver.handler.ts tests/integration/notifications-mailpit.test.ts
git commit -m "feat: deliver durable workflow notifications"
```

---

### Task 7: Finalize immutable publication

**Files:**
- Create: `packages/application/src/publication/finalize-publication.ts`
- Create: `packages/application/src/publication/get-publication.ts`
- Create: `packages/application/src/publication/open-public-download.ts`
- Create: `packages/application/src/publication/publication.test.ts`
- Create: `apps/worker/src/jobs/publication-finalize.handler.ts`
- Create: `apps/api/src/public/public.controller.ts`
- Create: `apps/api/src/public/public.module.ts`
- Create: `tests/integration/publication.test.ts`
- Create: `tests/faults/publication-crash-matrix.test.ts`

- [ ] **Step 1: Write failing publication and crash-matrix tests**

Inject crashes before/after stage VK unwrap, DEK unwrap, each secretstream chunk, ZIP validation, will rendering, public object promotion, DB transaction, public audit append, and notification outbox. Test tampered/truncated ciphertext, wrong wrapped DEK, bad ZIP, missing `will.md`, object conflicts, storage outage, DB outage, restart, and duplicate workers.

- [ ] **Step 2: Implement isolated streaming publication**

Worker reads locked workflow/package, unwraps staged VK and DEK, decrypts secretstream into an isolated non-web-root temporary object/directory with strict byte budget, validates ZIP/will, computes plaintext ZIP and rendered will digests, and promotes a deterministic content-addressed public ZIP key. Cleanup plaintext staging on every error.

- [ ] **Step 3: Commit database visibility atomically**

After the public object exists and hash matches, lock workflow again and insert immutable `publications`, sanitized rendered HTML, package/will/public-audit digests, set `RELEASED`, destroy staged VK, append public/private audit, and enqueue release notifications in one transaction. If this transaction fails, the unreferenced object remains unreachable; retry reuses it by hash.

- [ ] **Step 4: Implement public read/download surfaces**

Public status/will/audit routes read only committed publication records. Download handler resolves object key from that record, supports one legal Range, returns `Content-Disposition: attachment`, `nosniff`, immutable caching/ETag, no session cookie, and configured bandwidth/concurrency limits. It never accepts an object key/path query parameter.

- [ ] **Step 5: Prove irreversibility under app roles**

Tests assert API/worker SQL roles cannot update/delete publication/public-audit rows or public objects and that no controller/CLI exposes withdrawal. Infrastructure owners can still delete underlying resources; document this distinction.

- [ ] **Step 6: Verify and commit**

```powershell
pnpm.cmd exec vitest run tests/integration/publication.test.ts
pnpm.cmd exec vitest run tests/faults/publication-crash-matrix.test.ts
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
git add packages/application/src/publication apps/worker/src/jobs/publication-finalize.handler.ts apps/api/src/public tests/integration/publication.test.ts tests/faults/publication-crash-matrix.test.ts packages/contracts
git commit -m "feat: publish immutable digital legacy"
```

---

### Task 8: Run workflow/publication exit gate

**Files:**
- Create: `docs/operations/stage-key-capabilities.md`
- Create: `docs/acceptance/05-workflows-publication.md`

- [ ] **Step 1: Document secret mounts and rotations**

List each ingress/stage secret, owning process, forbidden process, version field, generation command, rotation window, health signal, loss consequence, and recovery procedure. Include no actual secret values.

- [ ] **Step 2: Run all workflow gates**

```powershell
pnpm.cmd test:integration
pnpm.cmd exec vitest run tests/concurrency
pnpm.cmd exec vitest run tests/faults
pnpm.cmd openapi:check
pnpm.cmd build
```

- [ ] **Step 3: Record and commit evidence**

Record threshold events, races, key-capability boot tests, notification failures, full crash matrix, public object/DB reconciliation, hashes, and Beijing timestamps.

```powershell
git add docs/operations/stage-key-capabilities.md docs/acceptance/05-workflows-publication.md
git commit -m "test: record workflow and publication acceptance"
```
