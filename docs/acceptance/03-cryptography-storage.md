# Cryptography and Storage Acceptance

Verification date: 2026-08-08, Beijing time. The acceptance record is evidence-backed; an unchecked item is intentionally not represented as passing.

## Completed evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Crypto protocol, key hierarchy, and stream suites | Passed | Pinned workspace run: 33/33 tests; protocol, key, stream, and VSS vectors are checked in; see `docs/security/cryptographic-protocol-v1.md`. |
| Filesystem storage contract | Passed | Size/hash verification, ranges, immutable promotion, conflict handling, path safety, and cleanup tests. |
| S3/MinIO adapter | Passed | Compose `storage-tests` exit gate under Node 24.18.0: 4 files, 14/14 tests against live MinIO. |
| Encrypted upload/activation application flow | Passed | `tests/integration/vault-upload.test.ts`: 4/4. Covers server-owned keys, stream binding, cancellation, READY gating, activation replacement, and abort idempotency. |
| PostgreSQL concurrency and integration | Passed | Temporary pinned PostgreSQL 18.4 container on host port 55432: concurrency 4/4 and integration 18/18. |
| API DTO boundary | Passed | `apps/api/src/vault/vault.dto.test.ts`: 2/2. Covers strict base64url decoding and malformed/padded input rejection. |
| API TypeScript build | Passed | `tsc -b packages/application apps/api`. |
| API formatting | Passed | Biome check on the vault/API/integration files. |
| OpenAPI contract | Passed | Generation followed by `--check`; `packages/contracts/openapi/openapi.json` is current. |
| Full TypeScript build | Passed | Node 24.18.0 Compose test image build completed `pnpm run build` for all buildable workspace projects. |

## Remaining gates

The independent cryptographic review of the VSS dependency and wrapper remains a production blocker; the implementation and automated gates are complete, but production release requires that external review.

## Rerun commands

Run these from the repository root after Docker Desktop and the pinned Node image are available:

```powershell
pnpm.cmd test:crypto
pnpm.cmd test:storage
pnpm.cmd exec vitest run tests/integration/vault-upload.test.ts
pnpm.cmd exec vitest run tests/concurrency --no-file-parallelism
docker compose --profile s3 --profile test up --build --abort-on-container-exit --exit-code-from storage-tests storage-tests
pnpm.cmd build
pnpm.cmd openapi:check
```
