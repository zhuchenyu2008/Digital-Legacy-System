# Windows 本地开发与验收

1. 安装 Docker Desktop，启用 WSL2 Linux container 后端；安装 Node `24.18.0`，由 Corepack 使用 pnpm `11.20.0`。
2. 在 PowerShell 中运行 `corepack pnpm install` 与 `node ops/scripts/generate-development-secrets.mjs`。生成值不会打印；不要把 `ops/secrets/generated` 提交到 Git。首次初始化 owner 时从本机受限文件 `ops/secrets/generated/setup-token` 读取 setup token，不要复制到日志或测试证据。
3. 默认 Compose 使用 PostgreSQL、Mailpit 和 filesystem storage。Mailpit 仅监听回环测试端口，不得替换成外部 SMTP。
4. 可选 S3 合约必须显式启用 `s3` profile；默认 profile 不应启动 MinIO。迁移流程见 `filesystem-s3-migration.md`。
5. Windows bind mount 使用绝对路径并为 Docker Desktop 开放盘符；仓库保持 LF。若出现 CRLF、路径共享或 ACL 错误，先查看 `docker compose config`、`docker compose ps` 和 `docker compose logs --no-color`。
6. 防火墙仅为需要的回环端口放行；不要暴露 PostgreSQL、Mailpit 或 MinIO 到局域网。浏览器测试使用脚本分配的端口，避免手工复用陈旧容器。
7. 关闭环境使用 `docker compose down`，默认保留 named volume。只有明确命名的 disposable 测试项目可执行 `--volumes`；先核对 project name。

隔离仿真只能由 `tests/e2e/compose.e2e.yaml` 的测试栈开启：API 必须同时使用 `NODE_ENV=test`、`DLS_TEST_MODE=true`、`DLS_SIMULATION_MODE=enabled`、独立的 `SIMULATION_DATABASE_URL` 和 `SIMULATION_STORAGE_ROOT`，邮件必须指向 Mailpit 并受 allowlist 限制。不要把这些标志加入默认或生产 Compose；生产 API、worker 和 Web 进程会拒绝 `DLS_TEST_MODE=true`。

常用门禁为 `corepack pnpm check`、`corepack pnpm typecheck`、`corepack pnpm test:unit`、`corepack pnpm build`。完整 Windows acceptance 由 `ops/scripts/acceptance.ps1` 驱动并生成证据；它要求 Docker、浏览器、S3、RustSec/Trivy 和空目标恢复均可运行，缺失工具会失败而不是跳过。生产部署仍应在受管 Linux 主机执行。

Linux 镜像 parity 可通过 `docker compose --profile test up --build --abort-on-container-exit acceptance` 单独验证。该容器不会挂载 Docker socket，也不会在容器内嵌套编排 Docker；Compose 在外层启动迁移和真实服务，容器运行只读的格式、unit、crypto、filesystem storage、email、OpenAPI、security 与构建产物门禁，并写入 `docs/acceptance/linux-container-evidence.json`。正式收口时应比较 Windows 与 Linux 证据中的 Protocol、Vectors、Application SHA-256；任一不一致均视为失败。完整 Docker/S3/备份恢复门禁仍由宿主机 acceptance 脚本负责。
