# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG GO_IMAGE=golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848
ARG CADDY_BUILD_IMAGE=golang:1.26.6-alpine3.24@sha256:af8d6740070b8906d12eae1c3e3ea0957fb63f492051ea05e354c38ef9fe88df
ARG CADDY_RUNTIME_IMAGE=alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
ARG RUST_IMAGE=rust:1.97.1-bookworm@sha256:14bc9c5966e7b3a385794b3d5389a8765668342025fbcc7b2e3d2866ac4bd8c3

FROM ${RUST_IMAGE} AS rust-test

WORKDIR /workspace

COPY rust-toolchain.toml Cargo.toml Cargo.lock ./
COPY packages/vss-wasm ./packages/vss-wasm

RUN cargo test --locked

FROM rust-test AS rust-audit

RUN cargo install cargo-audit --version 0.22.2 --locked \
  && cargo audit

FROM rust-test AS rust-wasm

RUN rustup target add wasm32-unknown-unknown \
  && cargo install wasm-bindgen-cli --version 0.2.126 --locked \
  && cargo build --release -p dls-vss --target wasm32-unknown-unknown --locked \
  && mkdir -p packages/vss-wasm/dist/browser packages/vss-wasm/dist/node \
  && wasm-bindgen target/wasm32-unknown-unknown/release/dls_vss.wasm --target web --out-dir packages/vss-wasm/dist/browser \
  && wasm-bindgen target/wasm32-unknown-unknown/release/dls_vss.wasm --target nodejs --out-dir packages/vss-wasm/dist/node

FROM ${NODE_IMAGE} AS node-toolchain

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:${PATH}
WORKDIR /workspace

RUN corepack enable \
  && corepack prepare pnpm@11.20.0 --activate

FROM node-toolchain AS dependency-manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/application/package.json ./packages/application/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/crypto/package.json ./packages/crypto/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/email-templates/package.json ./packages/email-templates/package.json
COPY packages/persistence/package.json ./packages/persistence/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/test-fixtures/package.json ./packages/test-fixtures/package.json
COPY packages/vss-wasm/package.json ./packages/vss-wasm/package.json

FROM dependency-manifests AS development-dependencies
RUN pnpm install --frozen-lockfile

FROM development-dependencies AS build
COPY . .
COPY --from=rust-wasm /workspace/packages/vss-wasm/dist ./packages/vss-wasm/dist
RUN printf '{\n  "type": "commonjs"\n}\n' > packages/vss-wasm/dist/node/package.json
RUN node packages/vss-wasm/scripts/write-checksums.mjs
RUN pnpm run build

FROM dependency-manifests AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM ${NODE_IMAGE} AS application-runtime

ENV NODE_ENV=production
WORKDIR /workspace

RUN mkdir -p \
    /var/lib/dls/objects/private \
    /var/lib/dls/objects/staging \
    /var/lib/dls/objects/public \
  && chown -R node:node /workspace /var/lib/dls \
  && rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /opt/yarn-v1.22.22 \
  && rm -f \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

COPY --from=production-dependencies --chown=node:node /workspace/ ./
COPY --from=build --chown=node:node /workspace/packages/application/dist ./packages/application/dist
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /workspace/packages/crypto/dist ./packages/crypto/dist
COPY --from=build --chown=node:node /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /workspace/packages/email-templates/dist ./packages/email-templates/dist
COPY --from=build --chown=node:node /workspace/packages/persistence/dist ./packages/persistence/dist
COPY --from=build --chown=node:node /workspace/packages/persistence/migrations ./packages/persistence/migrations
COPY --from=build --chown=node:node /workspace/packages/storage/dist ./packages/storage/dist
COPY --from=build --chown=node:node /workspace/packages/test-fixtures/dist ./packages/test-fixtures/dist
COPY --from=build --chown=node:node /workspace/packages/vss-wasm/dist ./packages/vss-wasm/dist
COPY --from=build --chown=node:node /workspace/ops/scripts/migrator-database-url.mjs ./ops/scripts/migrator-database-url.mjs
COPY --from=build --chown=node:node /workspace/ops/scripts/migration-status.mjs ./ops/scripts/migration-status.mjs
COPY --from=build --chown=node:node /workspace/ops/scripts/verify-runtime-migrations.mjs ./ops/scripts/verify-runtime-migrations.mjs
COPY --from=build --chown=node:node /workspace/ops/scripts/runtime-reconcile.mjs ./ops/scripts/runtime-reconcile.mjs
COPY --from=build --chown=node:node /workspace/ops/scripts/verify-audit.mjs ./ops/scripts/verify-audit.mjs
COPY --from=build --chown=node:node /workspace/ops/scripts/production-monitor.mjs ./ops/scripts/production-monitor.mjs

USER node

FROM application-runtime AS api
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

FROM application-runtime AS worker
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./apps/worker/dist
CMD ["node", "apps/worker/dist/main.js"]

FROM application-runtime AS web
COPY --from=build --chown=node:node /workspace/apps/web/.next ./apps/web/.next
EXPOSE 3000
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0", "--port", "3000"]

FROM build AS test
USER node
CMD ["pnpm", "acceptance"]

FROM ${CADDY_BUILD_IMAGE} AS caddy-build

WORKDIR /src/caddy
COPY ops/caddy/builder/go.mod ./
RUN for attempt in 1 2 3; do \
    if go mod download; then exit 0; fi; \
    if [ "$attempt" -eq 3 ]; then exit 1; fi; \
    sleep "$((attempt * 5))"; \
  done
RUN CGO_ENABLED=0 go build \
    -mod=mod \
    -trimpath \
    -buildvcs=false \
    -ldflags="-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v2.11.4" \
    -o /out/caddy \
    github.com/caddyserver/caddy/v2/cmd/caddy

FROM ${CADDY_RUNTIME_IMAGE} AS caddy

USER root
RUN apk add --no-cache ca-certificates tzdata \
  && mkdir -p /data /config \
  && chown -R 1000:1000 /data /config \
  && mkdir -p /etc/caddy
COPY --from=caddy-build --chown=1000:1000 /out/caddy /usr/local/bin/caddy-unprivileged

USER 1000:1000
ENTRYPOINT ["/usr/local/bin/caddy-unprivileged"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

# The requested MinIO release is source-only, so build the official tagged
# commit instead of silently falling back to an older container image.
FROM ${GO_IMAGE} AS minio-build

ARG MINIO_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
ARG MINIO_SOURCE_SHA256=45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841

WORKDIR /src/minio
ADD --checksum=sha256:${MINIO_SOURCE_SHA256} \
  https://codeload.github.com/minio/minio/tar.gz/${MINIO_COMMIT} /tmp/minio.tar.gz
RUN tar -xzf /tmp/minio.tar.gz --strip-components=1 -C /src/minio \
  && CGO_ENABLED=0 GOOS=linux go build \
    -tags kqueue \
    -trimpath \
    -ldflags="-s -w -X github.com/minio/minio/cmd.Version=2025-10-15T17:29:55Z -X github.com/minio/minio/cmd.CopyrightYear=2025 -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-10-15T17-29-55Z -X github.com/minio/minio/cmd.CommitID=${MINIO_COMMIT} -X github.com/minio/minio/cmd.ShortCommitID=9e49d5e7a648" \
    -o /out/minio .

FROM ${NODE_IMAGE} AS minio

LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
  org.opencontainers.image.revision="9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a" \
  org.opencontainers.image.version="RELEASE.2025-10-15T17-29-55Z"

RUN mkdir -p /data /home/node/.minio \
  && chown -R node:node /data /home/node
COPY --from=minio-build /out/minio /usr/local/bin/minio

USER node
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
