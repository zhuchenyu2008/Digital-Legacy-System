# Local V1 Acceptance Evidence

- 开始（北京时间）：2026年8月14日 23:13:09
- 结束（北京时间）：2026年8月14日 23:41:20
- Git commit：`2dfd968ba067870a6d0990c017d20dfecc7146d7`
- 工作树：dirty（证据生成期间允许 evidence 文件变化）
- Gate 汇总：24 passed / 0 failed / 0 skipped
- 时区：`Asia/Shanghai`
- 系统: win32 / x64
- 迁移版本: `020`
- 协议版本: `1`
- Protocol SHA-256: `faf3b7bb4f5524ba4b1fb84d9e1b7cc24dab09fb50de122b4bc26d3119f44c01`
- Vectors SHA-256: `46b54d72b09126a6282804922f9d4c8dfd011987e7f8826a45bc0d5127fa859c`
- Application SHA-256: `843c47deaa90800e4819f95af220c9985a6cdb77937eb9046ed3f4c7d567ccb3`

## 工具与版本

- docker: Docker version 29.2.0, build 0b9d198
- node: v24.18.0
- trivy: aquasec/trivy:0.73.0@sha256:7cced7cae583819fc7806d4cbc0dbbc7cad18b99f7d3e235192e6da8c091045c
- pnpm: 11.20.0
- dockerCompose: Docker Compose version v5.0.2

## 发行镜像

- alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
- aquasec/trivy:0.73.0@sha256:7cced7cae583819fc7806d4cbc0dbbc7cad18b99f7d3e235192e6da8c091045c
- axllent/mailpit:v1.30.6@sha256:7f33095f80e901f6ad08028f06ca284aa58fe84942be5496008d041d3b9f4d4d
- golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848
- golang:1.26.6-alpine3.24@sha256:af8d6740070b8906d12eae1c3e3ea0957fb63f492051ea05e354c38ef9fe88df
- minio-source:RELEASE.2025-10-15T17-29-55Z@sha256:45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841
- node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
- postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382
- rust:1.97.1-bookworm@sha256:14bc9c5966e7b3a385794b3d5389a8765668342025fbcc7b2e3d2866ac4bd8c3

## Gate 结果

| Gate | 状态 | Exit | 耗时 ms | 测试统计 | 命令 |
|---|---|---:|---:|---|---|
| versions | passed | 0 | 749 | — | node ops/scripts/release-metadata.mjs --verify |
| format | passed | 0 | 2662 | — | corepack pnpm check; corepack pnpm typecheck |
| unit | passed | 0 | 12690 | 573 passed | corepack pnpm test:unit |
| migration-up-down-up | passed | 0 | 3088 | 2 passed | start disposable PostgreSQL; corepack pnpm test:migrations |
| integration | passed | 0 | 14993 | 56 passed | corepack pnpm test:integration |
| concurrency | passed | 0 | 5061 | 10 passed | corepack pnpm test:concurrency |
| crypto | passed | 0 | 7587 | 42 passed | corepack pnpm test:crypto; docker build --target rust-test |
| storage-filesystem | passed | 0 | 2362 | 16 passed | corepack pnpm test:storage:filesystem |
| storage-s3 | passed | 0 | 109401 | — | PowerShell -File ops/scripts/storage-s3-contract.ps1 |
| email | passed | 0 | 1778 | 13 passed | corepack pnpm test:email |
| build | passed | 0 | 7783 | — | corepack pnpm build |
| openapi | passed | 0 | 4860 | — | corepack pnpm openapi:check |
| compose-smoke | passed | 0 | 108238 | — | PowerShell -File ops/scripts/compose-smoke.ps1 -DeleteVolumes |
| simulation | passed | 0 | 14851 | 56 passed | corepack pnpm exec vitest run tests/integration/simulation-isolation.test.ts |
| visual | passed | 0 | 100388 | 47 passed | corepack pnpm test:visual |
| a11y | passed | 0 | 180340 | 47 passed | corepack pnpm test:a11y |
| e2e-fixtures | passed | 0 | 9757 | 2 passed | corepack pnpm test:e2e |
| full-stack-e2e | passed | 0 | 450404 | 12 passed | corepack pnpm test:full-stack-e2e |
| security | passed | 0 | 531551 | 29 passed；4 passed | corepack pnpm test:security; corepack pnpm test:browser-security; PowerShell -File ops/scripts/security-scan.ps1 |
| publication-crash-matrix | passed | 0 | 1890 | 20 passed | corepack pnpm test:publication-crash-matrix |
| deployment | passed | 0 | 16489 | 50 passed | corepack pnpm test:deployment |
| production-compose | passed | 0 | 1478 | 4 passed | corepack pnpm test:production-compose; docker compose --env-file .env.production.example -f compose.yaml -f compose.prod.yaml config --quiet |
| backup-blank-restore | passed | 0 | 103072 | — | PowerShell -File ops/scripts/backup-restore-smoke.ps1 |
| reconciliation | passed | 0 | 286 | — | validate runtime-reconcile.mjs output from blank restore |

## Artifact SHA-256

- `package.json` — 3240 bytes — SHA-256 `dd87028e7d3d792080be6cc28d7870b289f49fb411feb076ba4537816ba6c641`
- `pnpm-lock.yaml` — 145955 bytes — SHA-256 `b8ddd84a3353d114bb7ff9e37e3fefa41c090fa1372de08eaa137520f1f03af9`
- `Dockerfile` — 7914 bytes — SHA-256 `098354fc697fd8ec42530489db6a9a891803e642436f75854ffae4794ac8483f`
- `compose.yaml` — 16675 bytes — SHA-256 `9c8428bd40f51d864d28cc9ac0b1123c39cf11d9b95e4794504e03734f195542`
- `compose.prod.yaml` — 7294 bytes — SHA-256 `399375840cf91a6cad7e8a08ed178f5df1c76f63b4875a76144ecc183dfaa102`
- `ops/security/trivy.yaml` — 551 bytes — SHA-256 `06de7173acaa1b741594a60214883a472672cbc89fdbce5c521c6a7c2c7d3361`
- `ops/security/allowed-vulnerabilities.yaml` — 36 bytes — SHA-256 `7c1051f6e2bc3943b7c1dbe4da229694455681b8875a346c99279e555edb733f`
- `.acceptance-artifacts/backup-restore-reconciliation.json` — 93 bytes — SHA-256 `1b8a244198ab0727c1800603db96c4b84e2cd9fc6e29a8006d58eb58df0c517a`

## 外部/人工 blocker

- Independent cryptography, legal, penetration, and recovery reviews remain external.
- Acceptance must fail rather than mark a missing tool or Docker environment as skipped.

本文件由 `ops/scripts/write-evidence.ts` 生成；环境变量、凭据、token 和密钥形状值会被脱敏。
