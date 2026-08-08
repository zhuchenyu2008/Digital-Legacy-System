# Cryptographic Protocol V1

Status: implemented for the local V1 protocol; independent cryptographic review is still a production gate.

This document describes the wire contract and operational boundaries. It contains no deployment secret, password, pepper, key, endpoint credential, or object-storage credential.

## Key hierarchy and contexts

The hierarchy is purpose-separated:

```text
owner password + deployment pepper -> owner authentication verifier
owner password + calibrated Argon2id profile -> owner unlock key
owner unlock key -> owner vault-key envelope -> vault key (VK)
VK -> package DEK envelope -> DLSF secretstream key
contact public key -> sealed contact private-key/share envelopes
```

The owner VK is never used directly as a file-stream key. Every wrapped key records `version`, `algorithm`, `purpose`, `keyId`, `nonce`, and `ciphertext`; the purpose is one of `owner-vk`, `contact-private-key`, `package-dek`, `release-stage-vk`, or `recovery-stage-vk`. XChaCha20-Poly1305-IETF is the V1 wrapped-key primitive and uses a 24-byte nonce.

Share-generation and package contexts are distinct. A share envelope binds the vault, generation, contact, share index, and share kind. A package DEK binds the vault, package ID, package version, and package purpose. A ciphertext copied between these contexts must fail authentication.

## Canonical AAD

Required fields are `protocol`, `version`, `purpose`, `vaultId`, `keyId`, and `algorithm`. Optional fields are `generationId`, `contactId`, `packageId`, and `packageVersion`. Unknown fields, missing required fields, empty identifiers, non-positive versions, and invalid package versions are rejected. The fields are sorted lexicographically and encoded as compact UTF-8 JSON; there is no whitespace or alternate encoding.

The stream frame context uses:

```text
protocol: dls-stream-v1
version: 1
purpose: encrypted-file-frame
vaultId: <vault UUID>
packageId: <package UUID>
packageVersion: <positive integer>
keyId: frame-<zero-based sequence>
algorithm: secretstream-xchacha20poly1305
```

## DLSF wire bytes

The fixed header is 32 bytes:

```text
4 bytes  ASCII DLSF
1 byte   format version = 1
1 byte   algorithm ID = 1
2 bytes  big-endian fixed header length = 32
24 bytes libsodium secretstream XChaCha20-Poly1305 header
```

Each frame is a 4-byte big-endian ciphertext length followed by the authenticated secretstream ciphertext. The ciphertext includes the 17-byte secretstream overhead. Plaintext frames are limited to 1 MiB and the final frame must carry the FINAL tag. Missing FINAL, truncation, reordering, duplication, appended frames, wrong AAD, and any authentication failure are rejected. A SHA-256 manifest records plaintext bytes, ciphertext bytes, both digests, frame count, version, and algorithm.

Encrypted vault package metadata additionally records the 24-byte stream header, ciphertext byte count and lowercase SHA-256, wrapped DEK, DEK nonce/algorithm/protocol/AAD digest, authenticated manifest ciphertext/nonce/algorithm/AAD digest, share-generation ID, and client crypto version. The server recomputes object size and digest before `READY` and never parses the encrypted ZIP before release.

## Password and KDF profiles

Passwords are normalized to NFC UTF-8, reject NUL and unpaired surrogates, and are limited to 512 UTF-8 bytes. Browser unlock uses Argon2id13 with a persisted V1 profile and calibrates the profile on the target device; the low-cost vector profile (`opsLimit=2`, `memLimit=8192`) is test-only. Server authentication uses native Argon2id with the current default profile of time cost 3, 64 MiB memory, parallelism 1, 32-byte output, and a 16-byte random salt. The deployment pepper is required to be at least 16 bytes and is never stored with the verifier.

Calibration must record the device class, measured duration, profile, and date. A profile change is a protocol/configuration migration, not an implicit compatibility change.

## Buffer and browser lifecycle

Mutable password, pepper-derived material, salts, secretstream keys, and temporary plaintext buffers are cleared in `finally` blocks wherever the runtime permits. JavaScript engines may copy or retain immutable strings and typed-array backing stores; this is a residual limitation, not a claim of perfect memory erasure. The browser implementation must keep plaintext lifetime bounded, avoid logging sensitive values, and treat a tab crash or worker termination as an interrupted operation.

The browser can verify and decrypt only after the authenticated package and manifest have been obtained. It must not rely on filesystem paths, server-side ZIP inspection, or a browser-readable server private key. The server stores only encrypted ciphertext and wrapped metadata.

## Dependency provenance and review gate

V1 pins `libsodium-wrappers-sumo 0.8.4`, native `argon2 0.45.1`, Rust toolchain `1.97.1`, `vsss-rs 5.4.0`, `wasm-bindgen 0.2.126`, and the protocol/storage package versions recorded in `pnpm-lock.yaml` and `Cargo.lock`. The current VSS dependency notes that its independent audit is not yet published. Production release therefore remains blocked until an independent cryptographic review covers the VSS wrapper, key contexts, AAD construction, stream framing, and browser bindings.

## Reproducibility hashes

SHA-256 hashes from the checked-in artifacts at the 2026-08-08 Beijing verification point:

| Artifact | SHA-256 |
| --- | --- |
| `packages/crypto/vectors/protocol-v1.json` | `C03790F1B44D341D5891DD9744A7DFC1A91214ACBF2AB17A6E256F338DA4DF7A` |
| `packages/crypto/vectors/keys-v1.json` | `2D1554AEF65B083BA15AE2E65CBC0311E4188D9EAB7226E771ECEA243DEF4A6C` |
| `packages/crypto/vectors/secretstream-v1.json` | `F57C9DAF590F42EF16593E5A2FE4A93EFA3DBF91878C90E102CBAA1C4084020A` |
| `packages/vss-wasm/vectors/pedersen-v1.json` | `C34616E04934EF0FF659F1EF494C614F82EC496687DAC1AFC6185F3697740162` |
| `packages/vss-wasm/dist/SHA256SUMS.json` | `F0AFD27070601714CFE05695FCDD761D0A90BE9347793EB1E2AC52D03DBF081B` |
| `packages/vss-wasm/dist/browser/dls_vss_bg.wasm` | `1782DC4695F2D567A3757D9D0BF9748256B2201676B4E18E80A2BABA86EB0C3D` |
