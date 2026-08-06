# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG GO_IMAGE=golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848
ARG CADDY_IMAGE=caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

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

FROM dependency-manifests AS development-dependencies
RUN pnpm install --frozen-lockfile

FROM development-dependencies AS build
COPY . .
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
  && chown -R node:node /workspace /var/lib/dls

COPY --from=production-dependencies --chown=node:node /workspace/ ./
COPY --from=build --chown=node:node /workspace/packages/application/dist ./packages/application/dist
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /workspace/packages/crypto/dist ./packages/crypto/dist
COPY --from=build --chown=node:node /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /workspace/packages/email-templates/dist ./packages/email-templates/dist
COPY --from=build --chown=node:node /workspace/packages/persistence/dist ./packages/persistence/dist
COPY --from=build --chown=node:node /workspace/packages/storage/dist ./packages/storage/dist
COPY --from=build --chown=node:node /workspace/packages/test-fixtures/dist ./packages/test-fixtures/dist

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

FROM ${CADDY_IMAGE} AS caddy

USER root
RUN cp /usr/bin/caddy /usr/local/bin/caddy-unprivileged \
  && chmod 0755 /usr/local/bin/caddy-unprivileged \
  && chown 1000:1000 /usr/local/bin/caddy-unprivileged

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
