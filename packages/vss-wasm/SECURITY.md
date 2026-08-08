# VSS security provenance

This package wraps `vsss-rs` **5.4.0** with the `curve25519` feature and its
Ristretto255 implementation. The Rust toolchain is pinned to **1.97.1** and
the WASM bindings are generated with `wasm-bindgen` **0.2.126**. The selected
source and generated bundle hashes are recorded in `dist/SHA256SUMS.json`.

The public format is `dls-pedersen-vss-v1`. A 32-byte secret is represented as
two 16-byte scalar components so every 32-byte input is reconstructed exactly;
each component has its own Pedersen and Feldman verifier sets. Shares bind the
threshold, share count, and a domain-separated SHA-256 digest of the caller's
vault/generation/purpose context. Decoding rejects malformed lengths, unknown
versions/flags, context mismatches, invalid identifiers, duplicate identifiers,
and failed Feldman or Pedersen verification before interpolation.

Production splitting uses `rand_core::OsRng`. The `test-vectors` Cargo feature
is disabled by default and exposes only a Rust test helper; it is not exported
by the TypeScript package. Test vectors are synthetic and are never production
configuration.

`vsss-rs` 5.4.0 documents that its current audit is not yet published. This
implementation therefore requires an independent cryptographic review before
production use. The review must cover the upstream library, the two-component
encoding, context binding, wire parsing, and generated browser/Node bundles.
