# Plan 3 / Task 2 — Pedersen VSS acceptance

- [x] Rust toolchain pinned to 1.97.1; `vsss-rs` pinned to 5.4.0; `wasm-bindgen` pinned to 0.2.126.
- [x] Production Rust tests pass: unit test plus 6/6 integration cases.
- [x] Test-only deterministic feature passes: unit test plus 7/7 integration cases.
- [x] Negative cases cover too few shares, duplicate/zero/out-of-range identifiers, context mismatch, malformed buffers, and corrupted shares/commitments.
- [x] wasm32 release build and Docker `rust-test`/`rust-wasm` stages pass.
- [x] Node TypeScript wrapper build and tests pass: 2/2.
- [x] Chromium web-bundle probe passes: exact 32-byte reconstruction and share verification.
- [x] Generated browser/Node bundles and SHA-256 manifest are committed under `packages/vss-wasm/dist`.
- [ ] Independent cryptographic review remains required before production use because the upstream audit is not published.

Evidence timestamp: 2026-08-08 Beijing time. The browser artifact uses `wasm-bindgen --target web` with explicit `initializeBrowser()`; Node uses the `nodejs` target.
