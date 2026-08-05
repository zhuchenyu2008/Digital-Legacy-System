# Digital Legacy System 工程与运维设计

> 文档状态：工程与运维设计基线
> 适用范围：开发、测试、部署、升级、故障处理和上线运行
> 默认业务时区：北京时间 `Asia/Shanghai`（UTC+8）
> 关联文档：[产品需求](./01-product-requirements.md) · [系统架构](./02-system-architecture.md) · [数据库设计](./03-database-design.md) · [安全与隐私](./05-security-privacy.md) · [测试与验收计划](./08-test-and-acceptance-plan.md)

## 1. 交付边界

V1 采用 TypeScript 单仓库和模块化单体：

- `apps/web`：Next.js 中文页面、浏览器端文件加密和联系人密钥操作；
- `apps/api`：NestJS API、认证、授权、事务、状态机和私有审计；
- `apps/worker`：截止扫描、邮件、重试、最终发布和测试时钟；
- `packages/domain`：状态迁移、自然日、门限和任务幂等规则；
- `packages/crypto`：浏览器/服务端共用的密码学协议、编码和测试向量；
- `packages/contracts`：OpenAPI DTO、错误码、事件类型和生成的客户端类型；
- `packages/email-templates`：版本化中文邮件模板；
- `migrations`：PostgreSQL 迁移、触发器、角色授权和种子数据；
- `infra`：Docker Compose、反向代理、Secret 示例、健康检查和部署脚本；
- `tests`：单元、密码学、集成、并发、端到端、无障碍和安全回归测试。

仓库必须同时包含锁文件、启动说明、测试命令和变更记录。未经用户确认，不把静态设计稿直接改造成生产代码。

## 2. 环境划分

| 环境 | 数据 | 邮件 | 公开地址 | 允许的操作 |
|---|---|---|---|---|
| `local` | 本地 PostgreSQL + 默认文件卷；可选 MinIO profile，全部为模拟数据 | 默认不出网，使用 Mailpit | 不公开 | 开发和单元/集成测试 |
| `staging` | 独立数据库和文件目录；选择 S3 时使用独立桶/前缀和 Secret | SMTP 沙箱，仅白名单 | 不被搜索引擎收录 | 真实浏览器、故障和发布演练 |
| `production` | 正式数据库 + 受保护文件卷；S3 兼容存储可选 | 正式 SMTP | 正式域名 | 仅通过上线门禁后启用 |

任何测试或预发布数据都不得写入正式数据库、正式存储路径/前缀、正式收件人或正式公开地址。环境变量必须包含显式的 `DLS_ENV`，服务启动时拒绝环境值与数据库、文件路径或 S3 前缀不匹配。

文件存储使用显式 `STORAGE_DRIVER=filesystem|s3`，本地和生产模板默认 `filesystem`。文件系统模式配置三个独立挂载点：私有密文、发布暂存和公开 ZIP；S3 模式配置端点、区域、私有桶和公开桶/前缀。数据库存在活动对象时禁止通过单纯修改环境变量切换后端，必须执行带 SHA-256 复核、审计和原子元数据更新的存储迁移 Runbook。

## 3. 生产拓扑

```text
Internet
  |
  +-- Caddy: 80/443、TLS、HSTS、请求大小和安全响应头
        |
        +-- web: Next.js
        +-- api: NestJS API ---- PostgreSQL
        |                       +-- private file volume / optional S3
        +-- worker: NestJS Worker-+-- public file volume / optional S3
                                +-- SMTP
```

生产只暴露 Caddy 的 80/443。PostgreSQL、API 内部端口、Worker、私有对象桶和 Secret 文件不对公网开放。API 与 Worker 使用不同数据库角色；迁移使用独立 `dls_migrator`，禁止应用容器启动时自动执行破坏性迁移。

## 4. Secret 与初始化

必须使用 Docker Secret、云 Secret 管理服务或权限为 `0400` 的只读文件注入以下 Secret：

```text
SETUP_TOKEN
RELEASE_STAGE_KEK
RECOVERY_STAGE_KEK
PII_KEK
PII_INDEX_KEY
TOKEN_HMAC_KEY
AUDIT_CHAIN_KEY
PASSWORD_PEPPER_V1 / 轮换期间保留旧版本
SMTP_PASSWORD
DATABASE_URL_API
DATABASE_URL_WORKER
DATABASE_URL_MIGRATOR
S3_ACCESS_KEY / S3_SECRET_KEY  # 仅选择 S3 适配器时需要
```

要求：

1. 每项 Secret 独立随机生成，至少 256 位；不能从主密码或同一根字符串派生。
2. `SETUP_TOKEN` 只在首次初始化时可用，使用成功后立即吊销；初始化接口在数据库存在管理员后永久拒绝。
3. Secret 不写入镜像、Git、普通环境变量、日志、任务参数和错误响应。
4. Secret 轮换必须有版本号、旧版本保留窗口和回滚说明；`RELEASE_STAGE_KEK` 与 `RECOVERY_STAGE_KEK` 分开轮换，轮换前必须处理各自活动会话。
5. API 只能读取 `RECOVERY_STAGE_KEK`，Worker 只能读取 `RELEASE_STAGE_KEK`；任何容器启动时发现权限超出该边界必须拒绝启动。
6. `PASSWORD_PEPPER` 轮换采用旧版本短期双读、成功认证后重哈希；必须保留 `password_pepper_version`，不能直接删除旧版本。
7. Secret 丢失在当前“无自动备份”决策下可能导致永久数据不可恢复，必须在上线确认中单独列示。

## 5. 部署流程

### 5.1 首次部署

1. 准备域名、TLS、SMTP、PostgreSQL、NTP、文件卷和 Secret；如选择 S3，再准备端点、桶和凭据。
2. 创建非 root 容器、最小权限数据库角色和受保护的私有/公开文件目录；S3 模式改为隔离桶/前缀。
3. 执行只读预检：版本、时区、容量、Secret 文件权限、数据库连接和所选存储后端权限。
4. 以 `dls_migrator` 执行迁移并运行迁移测试。
5. 启动 `web`、`api`、`worker` 和 Caddy。
6. 检查 `/health/live`、`/health/ready`、Worker 心跳和 SMTP 沙箱测试。
7. 通过初始化接口创建唯一管理员；完成联系人、分片、ZIP、SMTP 测试和风险确认后才能 `ARMED`。

### 5.2 例行发布

1. CI 通过类型检查、Lint、单元测试、密码学测试、集成测试、安全扫描和 OpenAPI 一致性检查。
2. 构建镜像并固定 digest，生成 SBOM。
3. 在 staging 执行迁移、冒烟测试、完整测试模式演练和真实浏览器检查。
4. 先部署兼容代码，再执行向前兼容迁移；禁止直接删除字段或枚举值。
5. 生产滚动重启 API/Worker，观察健康状态、任务积压和错误率。
6. 发布后执行关键流程只读冒烟测试；不得用正式数据触发死亡确认或发布。

### 5.3 回滚

- 应用镜像可以回滚，但数据库迁移必须采用前向兼容策略；不执行自动 `down` 迁移。
- 已写入的正式流程状态不能通过回滚应用代码恢复到旧状态。
- `publish_locked_at`、`RELEASED`、公开对象和公开审计不得回滚、删除或隐藏。
- 任何迁移无法安全回滚时，必须先停止发布并由人工评估，不允许脚本强制覆盖。

## 6. 数据、对象和生命周期

- PostgreSQL 使用 UTC，所有业务截止时间同时保存北京时间自然日或已计算的绝对时间。
- 私有文件目录或 S3 私有桶只保存加密 ZIP；公开目录或 S3 公开桶只保存 `RELEASED` 后的不可替换对象。
- 当前版本激活后旧密文异步删除，但旧版本摘要、版本号和审计记录保留。
- 发布表、公开审计表和已发布对象不配置普通应用删除权限或生命周期删除规则。
- 当前产品基线不执行自动备份。若后续改为备份，必须新增加密、密钥托管、恢复演练、保留期限和删除策略，不能只增加一个数据库 dump 定时任务。

## 7. 健康检查与运维观测

必须提供：

- `/health/live`：进程存活，不探测依赖；
- `/health/ready`：迁移版本、数据库、任务领取和所选文件存储后端基本可用；
- `/owner/system-health`：管理员查看 Worker 心跳、截止扫描、任务积压、SMTP 最后测试、存储后端类型和状态；
- 结构化 JSON 日志，包含 `requestId`/`jobId`，不包含密码、令牌、Cookie、密钥、分片或遗书正文；
- Worker 最近心跳、最后一次扫描和失败任务的私有审计。

当前基线不强制接入第三方监控平台，但生产运维必须至少有人工检查频率、容器日志保留方式、SMTP 失败检查和发布失败处理责任人。外部告警是否启用由产品所有者确认。

## 8. 必须具备的运行手册

上线前至少形成以下可执行 Runbook：

| Runbook | 触发 | 最低内容 |
|---|---|---|
| 首次初始化 | 新环境 | Secret、迁移、管理员创建、SMTP、分片、ZIP、ARMED |
| SMTP 故障 | 投递失败 | 普通通知主/备用回退；恢复链接/验证码只检查主邮箱；重试、凭据轮换、伪造邮件检查 |
| Worker 故障 | 截止/发布任务积压 | 停止写操作、恢复任务、检查幂等和审计 |
| 数据库故障 | ready 失败 | 只读/停写、连接恢复、迁移版本和状态核对 |
| 文件存储故障 | 上传/发布失败 | 私有密文保留、发布锁定、重试和文件卷/S3 权限检查 |
| 存储后端迁移 | 文件卷与 S3 之间切换 | 停止写入、逐对象复制、SHA-256 复核、原子元数据切换、回滚和审计 |
| 密钥泄露 | Secret 或账号泄露 | 按用途轮换 stage key、会话/令牌吊销、重分片、审计和通知 |
| 主密码恢复验证码异常 | 验证码暴力尝试、邮件泄露或重复消费 | 按挑战锁定、吊销链接/验证码/重包装会话、检查主邮箱投递和审计 |
| 误入发布流程 | 死亡确认误触发 | 截止前管理员终止；锁定后不承诺撤回 |
| 已发布争议 | `RELEASED` | 记录不可撤回事实，进行外部法律/平台协调，不删除系统证据 |

## 9. 上线前人工确认

管理员必须在正式 `ARMED` 前看到并确认：

1. 无 MFA 的账号风险；
2. 不做自动备份和 Secret 丢失的风险；
3. 发布后不可撤回、不可隐藏和可被复制传播；
4. SMTP 接收成功不代表收件人已阅读；
5. 系统记录联系人个人信息并可能涉及跨境处理；
6. 系统不保证遗嘱具有法律效力。

确认记录进入私有审计，不能用前端默认勾选代替。
