# Digital Legacy System

面向单一所有者的本地优先数字遗产保管与条件发布系统。

系统由所有者定期签到；逾期后，预先登记的紧急联系人按门限参与确认；达到门限并经过 24 小时最终撤销窗口后，系统才会发布遗嘱正文、数字遗产 ZIP 和脱敏公开审计。

> **当前基线：Local V1。** 核心 Web、API、worker、密码学、存储、通知、发布和运维工具已经实现，并有本地与 Linux 容器验收证据；这不等于已经获得生产上线批准。生产部署仍需要独立密码学审查、法律审查、人工渗透测试、恢复演练和明确的值班/告警责任人。

所有业务时间按北京时间（`Asia/Shanghai`，UTC+08:00）解释，数据库时间统一存储为 UTC。

本项目负责加密保管、条件触发、通知、发布和审计，不替代遗嘱签名、见证、公证或法律意见。

## 产品流程

1. **初始化**：创建唯一的所有者账户，配置主邮箱、备用邮箱、联系人、SMTP 和加密遗产包。
2. **日常运行**：所有者按北京时间自然日签到；系统发送截止前提醒。
3. **逾期确认**：所有者逾期后，系统冻结联系人快照；联系人分别登录并提交“可能/确认离世”或“仍然健在”的决定。
4. **最终撤销窗口**：肯定确认达到 `ceil(N × 70%)` 后进入 24 小时发布倒计时；窗口结束前，所有者仍可用主密码终止流程。
5. **不可逆发布**：倒计时结束后，系统解密并校验当前 ZIP，发布清洗后的 `will.md`、ZIP 下载和脱敏公开审计。`RELEASED` 之后不能撤回、删除、隐藏或替换。

## 当前实现状态

### 已实现

- 完整的 Next.js Web 业务界面：初始化、所有者登录/签到、密码恢复、联系人邀请与注册、联系人决定、文件管理、设置、健康页、审计页、演练页、公开遗产页和错误边界；
- NestJS + Fastify API：认证、CSRF/Origin/限流、所有者与联系人权限、设置、联系人、分片、加密文件、工作流、恢复、发布、审计、健康和邮件模板预览；
- pg-boss worker：签到截止扫描、工作流推进、通知投递与重试、outbox、分片处理、发布 finalize、恢复过期和对象清理；
- 浏览器端分块加密上传，服务端只保存私有密文；支持文件系统和 S3 兼容对象存储；
- Argon2id、XChaCha20-Poly1305、X25519、Shamir/Feldman VSS、DLSF 流式格式和版本化 stage key；
- 严格 ZIP/`will.md` 校验、内容寻址公开对象、HTML 清洗、不可变公开发布、Range/ETag/限流下载和脱敏审计；
- 测试模式下的隔离仿真、虚拟时间、Mailpit 和完整 Playwright 全栈夹具；生产配置会拒绝 `DLS_TEST_MODE=true`；
- Linux 生产 Compose、固定镜像 digest、部署/回滚、操作员驱动备份恢复、对象迁移和运行时对账脚本。

### 验收证据

`docs/acceptance/local-v1-evidence.md` 记录了 2026 年 8 月 14 日（北京时间）的本地 V1 验收：**24 个 gate 全部通过，0 failed，0 skipped**，覆盖格式与类型、单元/集成、并发、密码学、文件存储、邮件、构建、OpenAPI、视觉、无障碍、全栈 E2E、浏览器安全、发布崩溃矩阵、部署、生产 Compose、空目标备份恢复和运行时对账。

Linux 容器侧的证据见 [`docs/acceptance/linux-container-evidence.json`](./docs/acceptance/linux-container-evidence.json)。

### 仍需人工完成的生产前置条件

自动化验收不能替代以下批准：

- 独立密码学审查：KDF、VSS、X25519、发布/恢复 stage key、密钥销毁边界；
- 适用司法辖区的法律/遗嘱内容、联系人知情同意、通知和数据保留审查；
- 人工渗透测试：浏览器、HTTP、SMTP/SSRF、归档解析、Range 下载、任务/数据库权限边界；
- 在空白 PostgreSQL 和对象存储上完成备份恢复、审计链、公开下载和失败回滚演练；
- 监控、告警、证书、SMTP、磁盘、备份和值班责任人的书面确认。

详细门禁见 [`docs/operations/production-readiness.md`](./docs/operations/production-readiness.md)。

## 核心能力

| 领域 | 能力 |
| --- | --- |
| 身份与权限 | 单一 `OWNER`、多个 `CONTACT`、角色隔离、会话 Cookie、CSRF、Origin/Fetch Metadata 和限流 |
| 签到与触发 | 北京时间自然日签到、截止提醒、逾期扫描、数据库时间驱动的原子状态推进 |
| 联系人 | 一次性邀请、知情同意、`PENDING_KEYING`/`ACTIVE` 生命周期、密码修改和密钥分片登记 |
| 加密保管 | 浏览器端加密 ZIP、唯一根目录 `will.md`、完整性校验、版本激活和私有对象存储 |
| 死亡确认 | `ceil(N × 70%)` 门限、联系人决定锁定、否定确认终止、24 小时最终撤销窗口 |
| 主密码恢复 | 主邮箱启动、联系人门限批准、一次性重包装会话和验证码约束 |
| 发布 | 流式解密、ZIP/Markdown 清洗、不可变公开内容、公开审计和带 Range 的 ZIP 下载 |
| 通知 | 版本化中文邮件、SMTP 重试、主邮箱失败时的备用邮箱策略、幂等 outbox |
| 运维 | 深度 health、pg-boss 对账、固定镜像、部署/回滚、备份/恢复、文件系统↔S3 迁移 |

## 技术栈与目录

| 路径 | 职责 |
| --- | --- |
| `apps/web` | Next.js 16 Web 应用与完整业务界面；浏览器端加密、上传和联系人密钥操作 |
| `apps/api` | NestJS + Fastify HTTP API、认证、授权、工作流、公开读取和 OpenAPI |
| `apps/worker` | pg-boss 调度、截止扫描、通知投递、恢复/发布和后台清理 |
| `packages/application` | 用例、端口、事务边界和跨模块编排 |
| `packages/domain` | 状态机、门限、自然日和业务不变量 |
| `packages/crypto` | Argon2id、XChaCha20-Poly1305、X25519、DLSF、分片和 stage key 协议 |
| `packages/vss-wasm` | Rust/WASM Shamir + Feldman VSS |
| `packages/persistence` | PostgreSQL 迁移、仓储、审计、outbox、pg-boss 和运行时对账 |
| `packages/storage` | 文件系统/S3 对象存储、ZIP 检查、清洗、清单和迁移工具 |
| `packages/contracts` | OpenAPI、DTO、错误码和生成客户端 |
| `packages/email-templates` | 变量严格校验的版本化中文邮件模板 |
| `ops` | Compose、Caddy、secret、部署、回滚、备份、恢复和安全扫描脚本 |
| `tests` | 单元、集成、并发、故障注入、浏览器 E2E、视觉、无障碍、安全和部署验收 |

API 契约见 [`packages/contracts/openapi/openapi.json`](./packages/contracts/openapi/openapi.json)。

## 本地快速启动

### 环境要求

- Node.js `24.18.0`；
- pnpm `11.20.0`（仓库通过 Corepack 固定）；
- Docker Desktop 或兼容的 Docker Engine + Compose v2；
- Windows PowerShell 7，或 Linux/macOS POSIX shell。

安装依赖：

```powershell
corepack enable
corepack prepare pnpm@11.20.0 --activate
pnpm install --frozen-lockfile
```

### Docker Compose

1. 生成仅用于本地开发的 secret 文件：

   ```powershell
   node ops/scripts/generate-development-secrets.mjs
   ```

   文件默认写入被 Git 忽略的 `ops/secrets/generated/`，生成器不会覆盖已有值，也不会输出密钥内容。

2. 构建应用和迁移镜像：

   ```powershell
   docker compose --profile ops build migrator api worker web caddy
   ```

3. 启动 PostgreSQL、Mailpit，执行迁移，再启动应用：

   ```powershell
   docker compose up -d postgres mailpit
   docker compose --profile ops run --rm migrator
   docker compose up -d api worker web caddy
   ```

4. 检查服务：

   ```powershell
   Invoke-RestMethod http://127.0.0.1:8080/health/ready
   ```

   本地 Web 入口为 `http://127.0.0.1:8080`。HTTP API 经 Caddy 的 `/api/*` 转发；Mailpit 是否映射主机端口取决于当前 Compose 配置。PostgreSQL、API 和 worker 默认不直接暴露到主机。

5. 停止服务：

   ```powershell
   docker compose down
   ```

   该命令保留数据卷。只有确认要清空本地数据库和对象时才使用 `docker compose down --volumes`。

如需本地 MinIO/S3 合约测试：

```powershell
docker compose --profile s3 up -d minio minio-init
```

## 验证与验收

常用门禁：

```powershell
pnpm check
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:crypto
pnpm test:storage
pnpm test:email
pnpm test:e2e
pnpm test:full-stack-e2e
pnpm test:visual
pnpm test:a11y
pnpm test:browser-security
pnpm test:deployment
pnpm openapi:check
pnpm build
```

完整本地验收（需要 Docker、PostgreSQL 测试连接和 Playwright）：

```powershell
pnpm acceptance
```

Windows 非交互终端或 CI 中如遇 pnpm 尝试清理 `node_modules` 的 TTY 提示，可使用：

```powershell
$env:CI = "true"
pnpm check
pnpm typecheck
```

Compose 启动、迁移、重启和持久卷检查：

```powershell
./ops/scripts/compose-smoke.ps1 -DeleteVolumes
```

Linux/macOS 对应脚本为 `./ops/scripts/compose-smoke.sh --delete-volumes`。

## 生产部署

生产默认使用 Linux x86_64/arm64、外部 SMTPS/STARTTLS、主机文件系统对象根和 Caddy 80/443；生产 Compose 不启动 Mailpit 或 MinIO。使用 S3 前，必须先按迁移手册完成维护窗口和对象校验。

生产目录约定：

- `/srv/dls/releases/<version>`：只读版本化发布包；
- `/srv/dls/data`：PostgreSQL 与 private/staging/public 对象；
- `/srv/dls/secrets`：权限 0700，secret 文件权限 0600；
- `/srv/dls/backups/<timestamp>`：已在空目标恢复验证过的备份。

初始化 secret：

```bash
bash ops/scripts/init-secrets.sh --deployment-dir /srv/dls
```

部署：

```bash
bash ops/scripts/deploy.sh \
  --version 2026.08.14 \
  --deployment-dir /srv/dls/releases/2026.08.14 \
  --backup-dir /srv/dls/backups/2026-08-14 \
  --env-file /srv/dls/releases/2026.08.14/.env.production
```

生产环境必须使用真实域名、外部 SMTP、不可变镜像 tag 和四个完整镜像 digest；`.env.production.example` 中的占位 digest、示例域名和全零同意文档摘要不可直接部署。

回滚只切换到兼容清单中明确列出的旧镜像，**不执行 migration down**：

```bash
bash ops/scripts/rollback.sh \
  --version 2026.08.10 \
  --deployment-dir /srv/dls/releases/2026.08.11 \
  --compatibility-manifest /srv/dls/releases/2026.08.10/compatibility.json \
  --env-file /srv/dls/releases/2026.08.11/.env.production
```

备份与恢复入口见 [`docs/operations/backup-restore.md`](./docs/operations/backup-restore.md)。备份是操作员驱动的一致性备份，不代表系统自动完成异地备份；备份只有恢复到空目标并完成对象、数据库、公开引用、审计和任务对账后才算有效。

## 安全边界与限制

- 系统只支持一个所有者，不支持多管理员、多租户、组织或家庭账号；
- 当前没有 MFA、自动备份、灾难恢复承诺或永久可用性保证；
- 系统不通过医院、公安、政府或第三方死亡数据库判断死亡；
- 邮件只发送通知和链接，不直接发送遗产 ZIP；
- 邮件模板页面当前支持安全预览，**不支持保存模板覆盖**，因为后端写入入口尚未提供；
- `/admin/simulations` 只在隔离测试模式可用，生产环境禁止 `DLS_TEST_MODE=true`；
- `RELEASED` 是不可撤销终态，公开内容不能通过应用修改、隐藏、删除或替换；
- 自动化测试不能替代独立密码学、法律、渗透和恢复审查；
- 密钥、密码、分片、Cookie、token、SMTP 内容和遗嘱正文不得写入日志、镜像、数据库元数据或备份清单。

## 配置与密钥

- 普通运行配置参考 [`.env.example`](./.env.example)；
- 生产配置模板见 [`.env.production.example`](./.env.production.example)；
- 开发 secret 清单见 [`ops/secrets/README.md`](./ops/secrets/README.md)；
- stage key、入口密钥、版本和轮换流程见 [`docs/operations/stage-key-capabilities.md`](./docs/operations/stage-key-capabilities.md)；
- API、worker、migrator 和 backup 使用不同数据库角色与 secret 能力，禁止跨进程挂载；
- 首次初始化的 `setup-token` 只能通过受限运维通道交给现场操作者，不能写入 `.env.production`、工单、聊天或日志。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [`docs/01-product-requirements.md`](./docs/01-product-requirements.md) | 产品目标、状态机、门限和业务规则 |
| [`docs/02-system-architecture.md`](./docs/02-system-architecture.md) | 系统组件、信任边界和数据流 |
| [`docs/03-database-design.md`](./docs/03-database-design.md) | PostgreSQL 模型、约束与审计 |
| [`docs/04-api-design.md`](./docs/04-api-design.md) | REST 契约和错误语义 |
| [`docs/05-security-privacy.md`](./docs/05-security-privacy.md) | 威胁模型、密码学和隐私边界 |
| [`docs/06-page-specifications.md`](./docs/06-page-specifications.md) | 页面、交互、响应式和无障碍规格 |
| [`docs/07-implementation-and-operations.md`](./docs/07-implementation-and-operations.md) | 工程、生产拓扑、部署和运行责任 |
| [`docs/08-test-and-acceptance-plan.md`](./docs/08-test-and-acceptance-plan.md) | 测试矩阵、性能目标和上线门禁 |
| [`docs/operations/linux-deployment.md`](./docs/operations/linux-deployment.md) | Linux 生产部署与发布流程 |
| [`docs/operations/backup-restore.md`](./docs/operations/backup-restore.md) | 备份、空目标恢复和验证 |
| [`docs/operations/upgrade-rollback.md`](./docs/operations/upgrade-rollback.md) | 版本升级、兼容清单和回滚 |
| [`docs/operations/monitoring-alerts.md`](./docs/operations/monitoring-alerts.md) | 监控信号、告警和值班动作 |
| [`docs/operations/incident-response.md`](./docs/operations/incident-response.md) | 密钥、数据库、存储、邮件和发布故障处置 |
| [`docs/acceptance/local-v1-evidence.md`](./docs/acceptance/local-v1-evidence.md) | 本地 V1 完整验收证据与工具版本 |

## License

本项目采用 [GNU General Public License v3.0](./LICENSE)。
