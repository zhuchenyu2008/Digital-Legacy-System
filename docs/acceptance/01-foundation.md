# Foundation / 工作包 1 验收证据

## 验收范围

- 计划：`docs/superpowers/plans/2026-08-05-01-foundation-infrastructure.md`
- 工作树：`D:\code\Digital-Legacy-System\.worktrees\codex-complete-local-v1`
- 分支：`codex/complete-local-v1`
- 验收提交：`61ee760`（证据文件提交前的代码 HEAD）
- 时间：2026-08-06（北京时间，`Asia/Shanghai`, UTC+08:00）

## 工具链

| 项目 | 实际值 |
| --- | --- |
| 宿主 Node.js | `v24.14.0`（低于项目要求；宿主仅用于本地脚本，产生 engine warning） |
| 项目固定 Node.js | `24.18.0`（`.node-version`、Docker 基础镜像均固定） |
| pnpm | `11.20.0` |
| Docker Engine | `29.2.0` |
| Docker Compose | `v5.0.2` |

根脚本通过 `corepack pnpm` 调用递归命令；验收日志中的所有嵌套 pnpm 均为 `11.20.0`。

## 命令证据

以下命令均在上述工作树执行，退出码均为 `0`：

| 北京时间 | 命令 | 结果 |
| --- | --- | --- |
| 2026-08-06 21:57:12 | `\.\corepack-bin\pnpm.CMD check` | Biome 检查 73 个文件，无错误/警告 |
| 2026-08-06 21:57:14 | `\.\corepack-bin\pnpm.CMD test:unit` | 9 个测试文件，43 个测试通过 |
| 2026-08-06 21:57:16 | `\.\corepack-bin\pnpm.CMD openapi:check` | API OpenAPI 与 contracts 生成客户端均无漂移 |
| 2026-08-06 21:57–21:57 | `\.\corepack-bin\pnpm.CMD build` | 11/12 workspace 项目执行 build；Next.js、API、Worker 均成功 |
| 2026-08-06 22:01:17 | `\.\corepack-bin\pnpm.CMD test:deployment` | 1 个文件，6 个部署策略测试通过 |
| 2026-08-06 22:05:15–22:06:21 | `powershell -NoProfile -File ops/scripts/compose-smoke.ps1 -DeleteVolumes` | `Compose smoke test passed on http://127.0.0.1:54265` |

额外验证：`\.\node_modules\.bin\tsc.CMD --build --pretty false`、contracts 测试（18/18）、OpenAPI drift 测试（1/1）、Docker `compose build web api worker` 均退出码 `0`。

## 固定镜像与源码摘要

| 用途 | 固定引用 |
| --- | --- |
| Dockerfile frontend | `docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e` |
| Node | `node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d` |
| Go | `golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848` |
| Caddy | `caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648` |
| PostgreSQL | `postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382` |
| Mailpit | `axllent/mailpit:v1.30.6@sha256:7f33095f80e901f6ad08028f06ca284aa58fe84942be5496008d041d3b9f4d4d` |
| MinIO 源码 release | `RELEASE.2025-10-15T17-29-55Z`，commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` |
| MinIO tarball | SHA-256 `45521908307306e925c98d629e1c17d78c8b72b6ee242b1bfb1409f7d8ee5841` |

## Docker smoke 覆盖内容

- 构建 `api`、`worker`、`web` 镜像并通过容器内 frozen lockfile 安装。
- 默认服务 `api`、`caddy`、`mailpit`、`postgres`、`web`、`worker` 健康启动。
- 通过 Caddy readiness；默认 profile 未启动 `minio` / `minio-init`。
- 重启 API 与 Worker 后 readiness 仍通过。
- PostgreSQL marker 和 `private` / `staging` / `public` 三个对象卷 marker 均持久。
- `-DeleteVolumes` 清理容器、网络及全部 smoke 命名卷；未留下测试资源。

## 修复记录

在 2026-08-06 21:58 左右的一次 smoke 中，Docker Hub 对未固定的 `docker/dockerfile:1.7` frontend 返回 EOF，服务尚未创建。新增 deployment 回归测试后将 frontend 固定到上述 digest；随后 deployment 6/6 通过，22:05–22:06 的带时间 smoke 完整通过。该记录不影响最终退出码证据。

## 外部 assurance 边界

本文件只证明工作包 1 的本地自动化行为与可复现基础设施。正式生产发布仍需计划中要求的独立密码学审查、法律审查、备份恢复演练和人工渗透测试证据。
