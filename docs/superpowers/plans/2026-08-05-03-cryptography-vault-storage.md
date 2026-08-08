# Cryptography, Vault, and Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved key hierarchy, browser/Node interoperable authenticated encryption, verifiable secret sharing, encrypted ZIP transport, safe ZIP inspection, and interchangeable filesystem/S3 object storage.

**Architecture:** `packages/crypto` owns versioned wire formats and delegates primitives to libsodium. `packages/vss-wasm` wraps pinned `vsss-rs` Pedersen VSS so browser and Node execute the same audited source code. The API stores only ciphertext, commitments, digests, public keys, and wrapped material. `StoragePort` separates object namespaces from provider details. Vault application services stream ciphertext and activate versions transactionally.

**Tech Stack:** libsodium-wrappers-sumo 0.8.4, native argon2 0.45.1, Rust 1.97.1, vsss-rs 5.4.0, wasm-bindgen 0.2.126, AWS SDK S3 3.1103.0, yauzl 3.4.0, marked 18.0.9, sanitize-html 2.17.6, Vitest 4.1.10.

## Global Constraints

- Do not implement cryptographic primitives, finite-field math, AEAD, secretstream, X25519, Argon2id, or SHA-256 by hand.
- Pin `Cargo.lock`, the Rust toolchain, crate versions, WASM output hash, npm versions, algorithm identifiers, parameter profiles, and wire-format versions.
- Production randomness always comes from the runtime CSPRNG. Deterministic seeds exist only behind a test-only Rust feature and are absent from production WASM exports.
- Every encryption call uses purpose-separated canonical AAD. Decoding rejects unknown versions/algorithms, duplicate fields, noncanonical base64url, length mismatch, trailing bytes, and impossible indexes before primitive invocation.
- Zero mutable plaintext/key buffers in `finally` blocks. JavaScript copies cannot be guaranteed fully erasable; document that limit and minimize lifetime/scope.
- `vsss-rs` 5.4.0 states that its current audit is not yet published. Use it for the real V1 implementation with fixed/differential tests, but keep independent cryptographic review as a production blocker.
- Storage object keys are server-generated UUID paths and never derived from filenames, email addresses, owner names, or client-supplied paths.

---

### Task 1: Freeze cryptographic protocol encodings and password profiles

**Files:**
- Create: `packages/crypto/src/protocol/algorithms.ts`
- Create: `packages/crypto/src/protocol/base64url.ts`
- Create: `packages/crypto/src/protocol/canonical-aad.ts`
- Create: `packages/crypto/src/protocol/envelopes.ts`
- Create: `packages/crypto/src/password/normalize-password.ts`
- Create: `packages/crypto/src/password/browser-kdf.ts`
- Create: `packages/crypto/src/password/server-auth.ts`
- Create: `packages/crypto/src/protocol/protocol.test.ts`
- Create: `packages/crypto/vectors/protocol-v1.json`
- Update: `packages/crypto/package.json`
- Update: `pnpm-lock.yaml`

- [x] **Step 1: Write failing encoding and normalization tests**

Password normalization is Unicode NFC, UTF-8, no trim/case-fold/silent truncation, maximum 512 bytes. Test composed/decomposed Chinese and Latin input, leading/trailing spaces, NUL rejection, and 512/513-byte boundaries.

Freeze these public structures with Zod strict schemas:

```ts
export type WrappedKeyV1 = Readonly<{
  version: 1;
  algorithm: "xchacha20poly1305-ietf";
  purpose: "owner-vk" | "contact-private-key" | "package-dek" | "release-stage-vk" | "recovery-stage-vk";
  keyId: string;
  nonce: string;
  ciphertext: string;
}>;

export type KdfProfileV1 = Readonly<{
  version: 1;
  algorithm: "argon2id13";
  opsLimit: number;
  memLimit: number;
  salt: string;
  outputBytes: 32;
}>;
```

AAD is canonical UTF-8 JSON of `protocol`, `version`, `purpose`, `vaultId`, `generationId?`, `contactId?`, `packageId?`, `packageVersion?`, `keyId`, and `algorithm`; ciphertext never carries a client-authoritative AAD blob.

- [x] **Step 2: Run and observe failures**

```powershell
pnpm.cmd --filter @dls/crypto test -- protocol.test.ts
```

- [x] **Step 3: Implement strict codecs and KDFs**

Browser key derivation uses libsodium Argon2id with the stored profile and a calibrated default targeting roughly 500–1000 ms on the supported baseline device while honoring a hard memory ceiling. Server authentication uses native `argon2` with a separate random salt, deployment pepper, profile, and PHC string. The client salt and authentication salt are always distinct.

- [x] **Step 4: Generate committed non-secret vectors**

Vectors contain synthetic passwords, fixed salts/nonces/keys, expected normalized bytes, AAD bytes, wrapped ciphertext, and rejection cases. Mark them `TEST ONLY`; none are accepted as production configuration.

- [x] **Step 5: Verify and commit**

```powershell
pnpm.cmd --filter @dls/crypto test
git add packages/crypto
git commit -m "feat: freeze cryptographic protocol v1"
```

---

### Task 2: Build the Rust/WASM Pedersen VSS core

**Files:**
- Create: `rust-toolchain.toml`
- Create: `Cargo.toml`
- Create: `packages/vss-wasm/Cargo.toml`
- Create: `packages/vss-wasm/src/lib.rs`
- Create: `packages/vss-wasm/tests/vectors.rs`
- Create: `packages/vss-wasm/package.json`
- Create: `packages/vss-wasm/tsconfig.json`
- Create: `packages/vss-wasm/scripts/build.mjs`
- Create: `packages/vss-wasm/src/index.ts`
- Create: `packages/vss-wasm/src/index.test.ts`
- Create: `packages/vss-wasm/dist/browser/dls_vss.js`
- Create: `packages/vss-wasm/dist/browser/dls_vss.d.ts`
- Create: `packages/vss-wasm/dist/browser/dls_vss_bg.wasm`
- Create: `packages/vss-wasm/dist/node/dls_vss.js`
- Create: `packages/vss-wasm/dist/node/dls_vss.d.ts`
- Create: `packages/vss-wasm/dist/node/dls_vss_bg.wasm`
- Create: `packages/vss-wasm/vectors/pedersen-v1.json`
- Create: `packages/vss-wasm/SECURITY.md`
- Update: `Dockerfile`

- [x] **Step 1: Write failing Rust fixed-vector tests**

Pin Rust `1.97.1`, `vsss-rs = "=5.4.0"`, and `wasm-bindgen = "=0.2.126"`. Root `Cargo.toml` is a workspace containing only `packages/vss-wasm`, so the generated `Cargo.lock` lives at repository root. Tests cover 32-byte secrets for `2-of-3`, `3-of-5`, and configured maximum contact count; reconstruct every valid combination; reject too few, duplicates, zero/out-of-range identifiers, mixed generations, wrong purposes, corrupted shares, and corrupted commitments.

WASM API:

```ts
export type VssSplit = Readonly<{ shares: readonly Uint8Array[]; commitments: Uint8Array }>;
export function splitPedersen(secret: Uint8Array, threshold: number, shareCount: number, context: Uint8Array): VssSplit;
export function verifyPedersenShare(share: Uint8Array, commitments: Uint8Array, context: Uint8Array): boolean;
export function combinePedersen(shares: readonly Uint8Array[], commitments: Uint8Array, context: Uint8Array): Uint8Array;
```

- [x] **Step 2: Observe the Rust test failure inside the pinned builder**

```powershell
docker build --target rust-test -t dls-rust-test .
docker run --rm dls-rust-test cargo test --locked
```

Expected: missing crate/package implementation.

- [x] **Step 3: Implement the narrow wrapper**

The `context` is a domain-separated digest of vault, generation, purpose, threshold, share count, and VK commitment. Rust validates all lengths/ranges. Production split obtains randomness from the supported CSPRNG; the deterministic function is compiled only with `--features test-vectors` and is not re-exported by `index.ts`.

- [x] **Step 4: Produce deterministic browser and Node WASM bundles**

The build script runs `cargo test --locked`, `wasm-bindgen` for bundler and Node targets, strips nondeterministic metadata, and records SHA-256 hashes. Commit generated JS/TypeScript/WASM under `packages/vss-wasm/dist/` because application builds must not fetch toolchains at runtime.

- [x] **Step 5: Run cross-runtime and negative tests**

```powershell
pnpm.cmd --filter @dls/vss-wasm build
pnpm.cmd --filter @dls/vss-wasm test
docker run --rm dls-rust-test cargo test --locked
```

`index.test.ts` executes the same vectors in Node and Playwright Chromium, byte-compares results, and confirms production exports do not contain deterministic RNG hooks. The committed browser bundle uses the `web` target so static HTTP/browser loading performs explicit WASM initialization; the Node bundle uses the `nodejs` target.

- [x] **Step 6: Document provenance and commit**

`SECURITY.md` records source versions/licenses, upstream audit status, selected curve/features, test evidence, and the external-review blocker.

```powershell
git add rust-toolchain.toml Cargo.toml Cargo.lock packages/vss-wasm
git commit -m "feat: add pedersen vss wasm core"
```

---

### Task 3: Implement owner/contact keys, sealed shares, and wrapping

**Files:**
- Create: `packages/crypto/src/keys/key-material.ts`
- Create: `packages/crypto/src/keys/key-wrapping.ts`
- Create: `packages/crypto/src/keys/contact-key-pair.ts`
- Create: `packages/crypto/src/shares/share-envelope.ts`
- Create: `packages/crypto/src/shares/share-generation.ts`
- Create: `packages/crypto/src/keys/keys.test.ts`
- Create: `packages/crypto/vectors/keys-v1.json`

- [ ] **Step 1: Write failing hierarchy/interoperability tests**

Test random 32-byte VK generation, VK commitment, owner KEK wrap/unwrap, contact X25519 key generation, CONTACT_KEK private-key wrap, sealed-box share encrypt/decrypt, separate death/recovery generation, and package DEK wrap. Test wrong password/key/contact/generation/purpose/vault/package/version, ciphertext bit flips, replay, and mixed share sets.

Use `crypto_generichash` with explicit labels for commitments and key IDs. A contact share plaintext contains version, purpose, vault/generation/contact IDs, share index, threshold, commitment digest, and share bytes before sealed-box encryption.

- [ ] **Step 2: Run and observe missing-export failures**

```powershell
pnpm.cmd --filter @dls/crypto test -- keys.test.ts
```

- [ ] **Step 3: Implement browser and Node facades**

Expose only `Uint8Array` and immutable DTOs. Browser facade has no Node imports; Node facade has no DOM globals. Keep death-release and password-recovery shares in separate invocations with independent randomness and context.

- [ ] **Step 4: Prove password rotation semantics**

Tests show owner password change rewraps VK without changing `vkCommitment`, contact password change rewraps only CSK without changing CPK or sealed shares, and any partial failure leaves old wrapping active.

- [ ] **Step 5: Commit key hierarchy**

```powershell
pnpm.cmd --filter @dls/crypto test
git add packages/crypto
git commit -m "feat: implement vault and contact key hierarchy"
```

---

### Task 4: Implement authenticated streaming file format

**Files:**
- Create: `packages/crypto/src/stream/file-format.ts`
- Create: `packages/crypto/src/stream/encrypt-stream.ts`
- Create: `packages/crypto/src/stream/decrypt-stream.ts`
- Create: `packages/crypto/src/stream/stream.test.ts`
- Create: `packages/crypto/vectors/secretstream-v1.json`

- [ ] **Step 1: Write failing chunk and corruption tests**

Format v1 is `DLSF` magic, one-byte version, algorithm ID, fixed header length, libsodium secretstream header, followed by big-endian frame lengths and authenticated frames. The final frame must carry `TAG_FINAL`; no bytes may follow it. AAD binds package ID/version and chunk sequence.

Test empty, one-byte, exact-chunk, multi-chunk, and configured-max synthetic files; random input chunk boundaries; tamper/truncate/reorder/duplicate/append; wrong DEK/AAD; oversized frame; absent final tag. Node stream and browser `ReadableStream` outputs must be byte-identical for fixed vectors.

- [ ] **Step 2: Implement incremental encryption/decryption**

Never buffer the complete ZIP. Compute ciphertext and plaintext SHA-256 plus byte counts while streaming. Abort clears mutable state and does not emit a success manifest.

- [ ] **Step 3: Run stress/interoperability tests**

```powershell
pnpm.cmd --filter @dls/crypto test -- stream.test.ts
pnpm.cmd test:crypto
```

- [ ] **Step 4: Commit stream format**

```powershell
git add packages/crypto
git commit -m "feat: add authenticated encrypted file stream"
```

---

### Task 5: Define storage contracts and implement filesystem storage

**Files:**
- Create: `packages/application/src/ports/object-storage.ts`
- Create: `packages/storage/src/object-key.ts`
- Create: `packages/storage/src/filesystem/filesystem-storage.ts`
- Create: `packages/storage/src/filesystem/safe-path.ts`
- Create: `packages/storage/src/testing/storage-contract.ts`
- Create: `packages/storage/src/filesystem/filesystem-storage.test.ts`

- [ ] **Step 1: Write the shared failing contract suite**

Port:

```ts
export type ObjectNamespace = "private" | "staging" | "public";
export type ByteRange = Readonly<{ start: number; endInclusive?: number }>;
export interface ObjectStoragePort {
  put(input: { namespace: ObjectNamespace; key: string; body: AsyncIterable<Uint8Array>; expectedBytes?: number; expectedSha256?: string }): Promise<{ bytes: number; sha256: string; etag: string }>;
  head(namespace: ObjectNamespace, key: string): Promise<{ bytes: number; sha256: string; etag: string } | null>;
  read(namespace: ObjectNamespace, key: string, range?: ByteRange): Promise<{ body: AsyncIterable<Uint8Array>; bytes: number; totalBytes: number; etag: string }>;
  promote(input: { from: "staging"; to: "private" | "public"; sourceKey: string; destinationKey: string; expectedSha256: string }): Promise<void>;
  delete(namespace: "private" | "staging", key: string): Promise<void>;
}
```

Contract cases: empty/multi-chunk put, expected size/hash mismatch, head/read, all legal ranges, invalid ranges, destination immutability, idempotent same-hash promote, conflicting promote, source loss, interruption cleanup, concurrent writers, Unicode/path traversal/device names, restart persistence, and namespace isolation.

- [ ] **Step 2: Run filesystem suite and observe failure**

```powershell
pnpm.cmd --filter @dls/storage test -- filesystem-storage.test.ts
```

- [ ] **Step 3: Implement filesystem adapter**

Resolve configured absolute roots once; create directories with owner-only permissions where supported. Write to a same-filesystem random temporary path using exclusive create, fsync file and directory, verify count/hash, then atomically rename. Reject symlinks/reparse-point escapes and any key not matching the server-generated segmented UUID grammar. Public files are still served through the API/Caddy authorization path, never a direct mounted web root.

- [ ] **Step 4: Verify fault cases and commit**

```powershell
pnpm.cmd --filter @dls/storage test -- filesystem-storage.test.ts
git add packages/application/src/ports/object-storage.ts packages/storage
git commit -m "feat: add durable filesystem object storage"
```

---

### Task 6: Implement optional S3 storage with the identical contract

**Files:**
- Create: `packages/storage/src/s3/s3-storage.ts`
- Create: `packages/storage/src/s3/multipart-upload.ts`
- Create: `packages/storage/src/s3/s3-storage.test.ts`
- Create: `packages/storage/src/storage-factory.ts`
- Create: `packages/storage/src/storage-factory.test.ts`
- Update: `packages/storage/package.json`
- Update: `pnpm-lock.yaml`

- [ ] **Step 1: Instantiate the shared contract against MinIO**

Run `storageContract(() => new S3Storage(...))` with unique bucket prefixes and failure injection. Add multipart abort, stale upload cleanup, ETag-not-MD5, conditional destination write, range response, and provider timeout cases.

- [ ] **Step 2: Observe failure with the optional profile**

```powershell
docker compose --profile s3 up -d minio minio-init
pnpm.cmd --filter @dls/storage test -- s3-storage.test.ts
```

- [ ] **Step 3: Implement with AWS SDK**

Use exact AWS packages `3.1103.0`. Persist SHA-256 in object metadata and verify it independently; do not treat multipart ETag as a content digest. Promotion copies to an immutable destination with metadata replacement and verified hash before deleting staging. Configure endpoint/force-path-style only from typed config.

- [ ] **Step 4: Verify conditional factory behavior**

When driver is filesystem, tests prove no AWS client is constructed and no `S3_*` values are required. When driver is S3, missing values fail before app bootstrap.

- [ ] **Step 5: Commit optional S3 support**

```powershell
pnpm.cmd --filter @dls/storage test
pnpm.cmd test:storage
git add packages/storage package.json pnpm-lock.yaml
git commit -m "feat: add optional s3 object storage"
```

---

### Task 7: Implement hostile ZIP validation and safe will rendering

**Files:**
- Create: `packages/application/src/ports/archive-inspector.ts`
- Create: `packages/storage/src/archive/zip-inspector.ts`
- Create: `packages/storage/src/archive/zip-policy.ts`
- Create: `packages/storage/src/archive/render-will.ts`
- Create: `packages/storage/src/archive/zip-inspector.test.ts`
- Create: `tests/fixtures/archives/generate-fixtures.ts`
- Update: `packages/storage/package.json`
- Update: `pnpm-lock.yaml`

- [ ] **Step 1: Generate synthetic safe and hostile fixtures**

Fixtures cover valid `will.md`, missing/duplicate/case-mismatched `will.md`, path traversal, absolute/UNC paths, Windows device names, slash/backslash aliases, Unicode normalization collisions, symlink attributes, overlapping entries, encrypted entries, ZIP64 anomalies, >10,000 entries, compression ratio >100, total configured budget exceeded, `will.md` >2 MiB, invalid UTF-8, a plain nested archive treated as opaque downloadable content, an encrypted nested archive rejected by policy, and raw HTML/script/unsafe links in Markdown.

- [ ] **Step 2: Write failing inspector tests**

The inspector returns metadata and streams only root `will.md`; it never extracts the full archive. Rendering disables raw HTML, permits a narrow Markdown subset, sanitizes URL schemes, adds safe link attributes, and returns rendered HTML plus source/rendered SHA-256.

- [ ] **Step 3: Implement with yauzl, marked, and sanitize-html**

Use lazy entries, validate central/local header consistency, normalize each path before comparison, accumulate declared sizes with overflow checks, and stop at the first policy breach. No entry is written to the filesystem during validation.

- [ ] **Step 4: Verify resource bounds and commit**

```powershell
pnpm.cmd --filter @dls/storage test -- zip-inspector.test.ts
git add packages/application/src/ports/archive-inspector.ts packages/storage/src/archive tests/fixtures/archives
git commit -m "feat: validate archives and render wills safely"
```

---

### Task 8: Implement encrypted vault upload and activation use cases

**Files:**
- Create: `packages/application/src/vault/create-upload-session.ts`
- Create: `packages/application/src/vault/stream-upload.ts`
- Create: `packages/application/src/vault/complete-upload.ts`
- Create: `packages/application/src/vault/activate-package.ts`
- Create: `packages/application/src/vault/abort-upload.ts`
- Create: `apps/api/src/vault/vault.controller.ts`
- Create: `apps/api/src/vault/vault.module.ts`
- Create: `apps/api/src/vault/vault.dto.ts`
- Create: `tests/integration/vault-upload.test.ts`

- [ ] **Step 1: Write failing API/application tests from sections 7.1–7.5 of `docs/04-api-design.md`**

Filesystem flow returns an authenticated API streaming endpoint. S3 flow may return presigned multipart details. Both flows create server-owned object keys, bind upload ID/package version/expected cipher size and hash, enforce expiry/limits, recompute actual storage metadata, and require a complete authenticated secretstream manifest before `READY`.

- [ ] **Step 2: Implement session and upload streaming**

Stream request body directly to storage with byte limit and request cancellation. Never parse ZIP server-side before release because it is encrypted. Store ciphertext SHA-256, byte count, format version, wrapped DEK, package metadata, and upload status.

- [ ] **Step 3: Implement transactional activation**

Lock the vault and package rows, verify expected versions and current share generation, set one package `ACTIVE`, supersede the old row, insert outbox cleanup for old private ciphertext, and audit the new digest. Cleanup is idempotent and cannot delete the new object.

- [ ] **Step 4: Verify interruptions and races**

```powershell
pnpm.cmd exec vitest run tests/integration/vault-upload.test.ts
pnpm.cmd exec vitest run tests/concurrency/share-activation-race.test.ts
pnpm.cmd openapi:generate
pnpm.cmd openapi:check
```

- [ ] **Step 5: Commit vault application flow**

```powershell
git add packages/application/src/vault apps/api/src/vault tests/integration/vault-upload.test.ts packages/contracts
git commit -m "feat: upload and activate encrypted vault packages"
```

---

### Task 9: Run the cryptography/storage exit gate

**Files:**
- Create: `docs/security/cryptographic-protocol-v1.md`
- Create: `docs/acceptance/03-cryptography-storage.md`

- [ ] **Step 1: Document the protocol and residual risk**

Include key hierarchy, all AAD fields, wire bytes, KDF calibration procedure, state-key permissions, share contexts, buffer lifecycle, browser limitations, dependency provenance, vector hashes, and explicit independent-review blocker. Do not include any operational secret.

- [ ] **Step 2: Run all gates**

```powershell
pnpm.cmd test:crypto
pnpm.cmd test:storage
pnpm.cmd exec vitest run tests/integration/vault-upload.test.ts
docker compose --profile s3 --profile test up --build --abort-on-container-exit storage-tests
pnpm.cmd build
```

- [ ] **Step 3: Record and commit evidence**

Record browser/Node/Rust versions, WASM and vector hashes, both adapter results, corruption/resource-bound cases, and Beijing timestamps.

```powershell
git add docs/security/cryptographic-protocol-v1.md docs/acceptance/03-cryptography-storage.md
git commit -m "docs: record cryptography and storage acceptance"
```
