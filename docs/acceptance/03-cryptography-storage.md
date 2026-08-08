# Cryptography and Storage Acceptance

Verification date: 2026-08-08, Beijing time. The acceptance record is evidence-backed; an unchecked item is intentionally not represented as passing.

## Completed evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Crypto protocol, key hierarchy, and stream suites | Passed in prior pinned Node/Rust runs | Protocol, key, stream, VSS vectors and test suites are checked in; see `docs/security/cryptographic-protocol-v1.md`. |
| Filesystem storage contract | Passed | Size/hash verification, ranges, immutable promotion, conflict handling, path safety, and cleanup tests. |
| S3/MinIO adapter | Passed in prior Docker run | Multipart upload, metadata, range, promotion, idempotency, conflict, and failure-cleanup cases. |
| Encrypted upload/activation application flow | Passed | `tests/integration/vault-upload.test.ts`: 4/4. Covers server-owned keys, stream binding, cancellation, READY gating, activation replacement, and abort idempotency. |
| API DTO boundary | Passed | `apps/api/src/vault/vault.dto.test.ts`: 2/2. Covers strict base64url decoding and malformed/padded input rejection. |
| API TypeScript build | Passed | `tsc -b packages/application apps/api`. |
| API formatting | Passed | Biome check on the vault/API/integration files. |
| OpenAPI contract | Passed | Generation followed by `--check`; `packages/contracts/openapi/openapi.json` is current. |

## Remaining gates

The following are not claimed as passed in this environment:

- PostgreSQL-backed concurrency test `tests/concurrency/share-activation-race.test.ts` and the existing database integration suite require Docker Desktop/PostgreSQL. At the last check on 2026-08-08 21:09 Beijing time, `com.docker.service` was still `Stopped`; the Docker client and service start attempt did not recover it.
- The full S3 compose exit gate requires the Docker `storage-tests` service.
- A final all-workspace build/test run under the exact Node `24.18.0` container remains pending. The available desktop runtime reported Node `24.14.0`; it was used only for the non-container API checks above.
- Independent cryptographic review of the VSS dependency and wrapper remains a production blocker.

## Rerun commands

Run these from the repository root after Docker Desktop and the pinned Node image are available:

```powershell
pnpm.cmd test:crypto
pnpm.cmd test:storage
pnpm.cmd exec vitest run tests/integration/vault-upload.test.ts
pnpm.cmd exec vitest run tests/concurrency/share-activation-race.test.ts
docker compose --profile s3 --profile test up --build --abort-on-container-exit storage-tests
pnpm.cmd build
pnpm.cmd openapi:check
```
