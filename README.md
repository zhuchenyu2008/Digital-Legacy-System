# Digital Legacy System

Digital Legacy System（数字遗产系统）是一个面向单一所有者的本地优先数字遗产保管与条件发布系统。所有者定期签到；逾期后由预先登记的紧急联系人参与确认；达到门限并经过 24 小时最终撤销窗口后，系统才会发布遗嘱正文、数字遗产 ZIP 和脱敏审计链。

所有业务时间按北京时间（`Asia/Shanghai`，UTC+08:00）解释，数据库时间统一存储为 UTC。

> 本项目负责加密保管、条件触发、通知、发布和审计，不替代遗嘱签名、见证、公证或法律意见。当前代码属于本地 V1 工程交付，不应未经独立安全审计和运维加固直接用于生产。

## 当前状态

计划 1–5 已完成并有验收记录，覆盖工程基础、领域与持久化、密码学与存储、身份/签到/联系人，以及工作流/通知/不可变发布。

已实现的主要能力包括：

- 单所有者初始化、密码认证、会话/CSRF 防护和按北京时间自然日签到；
- 联系人邀请、知情同意、密钥登记、版本化 Shamir/VSS 分片与密文保管；
- 加密 ZIP 上传、完整性校验、版本激活及文件系统/S3 存储端口；
- 逾期检测、死亡确认、存活取消、24 小时发布倒计时和所有者密码恢复；
- API/worker 用途分离的 X25519 入口密钥与暂存 KEK，禁止跨进程挂载；
- 事务 outbox、幂等 pg-boss 任务、SMTP 重试/备用地址策略和版本化中文邮件；
- DLSF 流式解密、严格 ZIP/`will.md` 校验、内容寻址公开对象、原子可见性和不可变公开审计；
- 公开遗嘱、审计和 ZIP 下载接口，支持单段 Range、ETag、不可变缓存及带宽/并发限制。

`apps/web` 当前只提供可部署的 Next.js 服务壳；完整业务页面、交互式初始化和演练 UI 属于后续计划，不在本次计划 1–5 的完成范围内。后端 API 契约见 [`packages/contracts/openapi/openapi.json`](./packages/contracts/openapi/openapi.json)。

## 技术栈与目录

| 位置 | 职责 |
| --- | --- |
| `apps/api` | NestJS + Fastify HTTP API、认证、恢复和公开读取 |
| `apps/worker` | pg-boss 调度、工作流推进、通知投递和最终发布 |
| `apps/web` | Next.js Web 服务壳 |
| `packages/application` | 用例、端口、状态推进与事务边界 |
| `packages/domain` | 领域模型、状态机和业务不变量 |
| `packages/crypto` | Argon2id、XChaCha20-Poly1305、X25519、DLSF 流格式 |
| `packages/vss-wasm` | Rust/WASM Shamir + Feldman VSS |
| `packages/persistence` | PostgreSQL 迁移、仓储、审计、outbox 与 pg-boss 适配 |
| `packages/storage` | 文件系统和 S3 兼容对象存储 |
| `packages/contracts` | OpenAPI、DTO、错误码和生成客户端 |
| `packages/email-templates` | 严格变量校验的版本化中文邮件模板 |
| `tests` | 集成、并发、故障注入、部署和架构门禁 |

## 环境要求

- Node.js `24.18.0`；
- pnpm `11.20.0`（仓库通过 Corepack 固定）；
- Docker Desktop 或兼容的 Docker Engine + Compose v2；
- Windows PowerShell 7，或 Linux/macOS 的 POSIX shell。

安装依赖：

```powershell
corepack enable
corepack prepare pnpm@11.20.0 --activate
pnpm install --frozen-lockfile
```

## Docker Compose 快速启动

1. 生成仅用于本地开发的完整 secret 文件集：

   ```powershell
   node ops/scripts/generate-development-secrets.mjs
   ```

   生成器只创建缺失文件，不覆盖已有值，也不会输出密钥内容。密钥文件默认位于被 Git 忽略的 `ops/secrets/generated/`。

2. 构建应用和一次性迁移镜像：

   ```powershell
   docker compose --profile ops build migrator api worker web caddy
   ```

3. 启动 PostgreSQL 与 Mailpit，执行数据库迁移，再启动应用：

   ```powershell
   docker compose up -d postgres mailpit
   docker compose --profile ops run --rm migrator
   docker compose up -d api worker web caddy
   ```

4. 检查就绪状态：

   ```powershell
   Invoke-RestMethod http://127.0.0.1:8080/health/ready
   ```

   Web 服务入口为 `http://127.0.0.1:8080`，HTTP API 经 Caddy 的 `/api/*` 转发。默认只有 Caddy 绑定主机端口；PostgreSQL、Mailpit、API 和 worker 均不直接暴露到主机。

5. 停止服务：

   ```powershell
   docker compose down
   ```

   此命令保留数据库和对象卷。只有在确认要清空全部本地数据时才使用 `docker compose down --volumes`。

如需 MinIO，将 `DLS_STORAGE_DRIVER` 设置为 `s3`，并启用 `s3` profile。开发 secret 生成器已经包含 MinIO 凭据。

## 验证

完整验收需要 Docker、PostgreSQL 测试连接和 Playwright 运行环境：

```powershell
pnpm acceptance
```

常用的分层门禁：

```powershell
pnpm check
pnpm test:unit
pnpm test:integration
pnpm test:crypto
pnpm test:storage
pnpm test:security
pnpm test:deployment
pnpm exec vitest run tests/concurrency
pnpm exec vitest run tests/faults
pnpm openapi:check
pnpm build
```

当前计划 1–5 中，`test:e2e` 与 `test:security` 是分别为计划 6、计划 7 预留的隔离目录；目录为空时命令会明确报告零测试并退出成功，不代表浏览器 E2E 或对抗性安全覆盖已经完成。

Compose 启动、迁移、重启和持久卷检查可使用：

```powershell
./ops/scripts/compose-smoke.ps1 -DeleteVolumes
```

Linux/macOS 对应命令为 `./ops/scripts/compose-smoke.sh --delete-volumes`。

## 配置与密钥

- 普通运行配置参考 [`.env.example`](./.env.example)；
- 开发 secret 生成和文件清单见 [`ops/secrets/README.md`](./ops/secrets/README.md)；
- 入口密钥、暂存 KEK、版本和轮换流程见 [`docs/operations/stage-key-capabilities.md`](./docs/operations/stage-key-capabilities.md)；
- API 和 worker 必须只挂载各自拥有的密钥能力，任一禁止变量都会导致进程 fail closed；
- 生产环境不得复用开发 secret、共享 `.env` 或将密钥写入镜像、日志、数据库及对象存储。

## 设计与验收文档

| 文档 | 内容 |
| --- | --- |
| [`docs/01-product-requirements.md`](./docs/01-product-requirements.md) | 产品范围、状态机和业务规则 |
| [`docs/02-system-architecture.md`](./docs/02-system-architecture.md) | 系统组件、信任边界和数据流 |
| [`docs/03-database-design.md`](./docs/03-database-design.md) | PostgreSQL 模型、约束与审计 |
| [`docs/04-api-design.md`](./docs/04-api-design.md) | REST 契约和错误语义 |
| [`docs/05-security-privacy.md`](./docs/05-security-privacy.md) | 威胁模型、密码学与隐私边界 |
| [`docs/07-implementation-and-operations.md`](./docs/07-implementation-and-operations.md) | 工程、部署和运维基线 |
| [`docs/08-test-and-acceptance-plan.md`](./docs/08-test-and-acceptance-plan.md) | 测试矩阵和上线门禁 |
| [`docs/acceptance/05-workflows-publication.md`](./docs/acceptance/05-workflows-publication.md) | 计划 5 的实际验收证据 |

## 重要限制

- 系统只支持一个所有者，不支持多租户或组织账号；
- 当前没有 MFA、自动备份或灾难恢复承诺；
- 邮件只发送通知和链接，不直接发送遗产 ZIP；
- `RELEASED` 是不可撤销终态，公开内容不能通过应用修改、隐藏或删除；
- 自动化测试不能替代 VSS、密钥协议和整体部署的独立安全审计。
