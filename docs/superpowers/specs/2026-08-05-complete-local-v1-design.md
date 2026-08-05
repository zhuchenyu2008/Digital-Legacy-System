# Digital Legacy System 完整本地 V1 设计

> 文档状态：已确认设计，待实施计划
> 记录日期：2026-08-05（北京时间）
> 目标环境：Windows Docker Desktop 本地开发与验收
> 业务时区：`Asia/Shanghai`

## 1. 目标与范围

本设计用于把 Digital Legacy System 从设计/计划阶段落地为可运行、可测试、可验收的完整本地 V1。交付范围包括 Web、API、Worker、PostgreSQL、Mailpit、本地文件存储、真实密码学协议、数据库迁移、测试模式、端到端测试、Compose 烟测和验收证据。

本轮不连接真实 SMTP、正式域名、真实个人资料、真实遗书或生产公开地址。默认文件存储使用受权限保护的本地持久卷；S3 兼容存储只作为显式启用的可选 profile。生产部署、法律审查、密码学专家审查、外部监控和备份策略不在本地 V1 的完成声明内。

所有测试数据必须位于隔离命名空间，测试邮件必须带 `【测试】` 前缀并限制在白名单地址。数据库内部以 UTC 保存时间，页面和验收记录使用北京时间显示。

## 2. 架构与运行拓扑

系统采用 TypeScript pnpm 单仓库和模块化单体架构。API 与 Worker 分进程运行，共享领域和应用用例，但不共享进程内状态。

```text
apps/
  web/             Next.js 中文响应式界面
  api/             NestJS/Fastify HTTP API、认证、权限和事务
  worker/          NestJS 后台任务、邮件、调度和发布

packages/
  domain/          纯领域状态机、门限和北京时间规则
  application/     API/Worker 共用应用用例
  contracts/       DTO、错误码、事件和 OpenAPI 客户端
  crypto/          浏览器/Node 兼容密码协议
  persistence/     PostgreSQL 事务、仓储、锁、迁移和任务持久化
  storage/         文件系统适配器与可选 S3 适配器
  email-templates/ 中文邮件模板
  test-fixtures/   固定密码学向量和集成测试数据

infra/
  compose、Caddy、Secret 示例、迁移和部署脚本
tests/
  单元、集成、密码学、安全、E2E、无障碍和运维测试
```

默认 Compose 服务为 `caddy`、`web`、`api`、`worker`、`postgres`、`mailpit`。只有 Caddy 发布应用端口；数据库、API、Worker 和 Mailpit 仅在内部网络可访问。MinIO 及初始化容器仅在 `s3` profile 下启动，默认启动不需要 S3 凭据。

文件卷分离为 `private`、`publication-staging` 和 `public`，私有卷不位于 Web Root。服务使用非 root 用户运行，密钥通过只读 Secret 文件注入。容器健康检查验证真实服务就绪状态，`depends_on` 使用健康条件。

业务写入先在 PostgreSQL 事务内更新状态并写入 Outbox 或持久化任务，再由 Worker 领取、幂等执行和重试。所有截止判断以 PostgreSQL `clock_timestamp()` 为最终时间源；并发竞争使用行锁、版本条件更新和唯一约束裁决。

## 3. 领域状态机与数据流

正式状态机如下：

```text
SETUP
  -> ARMED                    配置完成、至少 3 名有效联系人、ZIP 已激活、分片已生成、SMTP 测试成功且风险已确认
ARMED
  -> ARMED                    管理员登录或签到
  -> PASSWORD_RECOVERY        管理员通过主邮箱启动忘记密码流程
  -> DEATH_CONFIRMING         到达未签到截止时间
PASSWORD_RECOVERY
  -> ARMED                    重置成功、旧密码取消或 7 天过期
  -> DEATH_CONFIRMING         未签到截止时间先到
DEATH_CONFIRMING
  -> ARMED                    管理员终止或联系人确认仍健在
  -> RELEASE_PENDING          肯定确认达到 ceil(N × 70%) 门限
RELEASE_PENDING
  -> ARMED                    24 小时前管理员终止且尚未锁定发布
  -> RELEASED                 24 小时到期并完成发布
RELEASED                     不可逆终态
```

死亡流程启动时锁定有效联系人集合、人数 `N`、门限和分片代次快照。同一联系人在同一流程只能决定一次；达到门限只需最后一位达到门限的联系人，不要求所有联系人确认。`RELEASE_PENDING` 与管理员终止、到期发布通过同一数据库条件更新竞争，最终只能产生一个终态。

密码恢复使用独立门限 `floor(N ÷ 2) + 1`。恢复流程不暂停未签到计时；若未签到截止先到，恢复流程立即取消并进入 `DEATH_CONFIRMING`。达到恢复门限后，只有主邮箱的一次性链接和验证码可以建立重包装会话；备用邮箱不自动接收同一验证码。

数据库按 `app`、`audit`、`simulation` 分区。核心实体包括：管理员资料/凭据/系统设置；联系人/邀请/知情同意；保险库/分片代次/联系人密钥分片/遗产包；签到记录/签到计划；流程/流程联系人/流程决定/临时密钥片段/发布与恢复会话；认证会话/一次性令牌/恢复验证码；通知/发送尝试/Outbox；私有审计/公开审计/公开发布记录；测试模拟数据。

`RELEASED` 后不存在删除、替换、取消或重新隐藏路径。发布对象必须先完成完整性验证，再以确定性对象键原子提升为公开对象；若数据库事务失败，公开下载处理器不得访问未被发布记录引用的对象。

## 4. 加密与文件存储边界

密码先执行 Unicode NFC 并编码为 UTF-8，不 `trim`、不大小写折叠、不静默截断；实现同时限制 Unicode 字符数和 UTF-8 字节数。认证使用版本化 pepper + Argon2id，浏览器密钥派生不接触服务端 pepper。

浏览器生成 256 位保险库密钥 `VK`。数据库只保存 `vkCommitment` 和版本化包装，不保存明文 `VK`、主密码或 `OWNER_KEK`。`OWNER_KEK` 与 `CONTACT_KEK` 使用 Argon2id 派生，每次包装使用独立随机 nonce 的 XChaCha20-Poly1305，并以协议版本、用途、主体、保险库/联系人、对象/代次和算法参数构造长度前缀 AAD。

ZIP 使用 libsodium secretstream 分块加密，必须包含 manifest、认证头和最终标签。根目录必须存在唯一、大小写敏感的 `will.md`；服务端重新读取实际对象并计算大小、SHA-256、manifest 和完整性，不能信任客户端自报摘要。发布时仅安全读取根目录 `will.md`，禁用 Markdown 原始 HTML 并执行 HTML 清洗。

联系人私钥使用 X25519 sealed box 加密。死亡发布和主密码恢复使用两套独立 Shamir 分片、随机多项式、门限、用途标签和代次承诺，禁止跨流程混用。只有进入相应阶段后，受限进程才在短暂内存窗口中获得 `RELEASE_STAGE_KEK` 或 `RECOVERY_STAGE_KEK` 包装；API 与 Worker 的 Secret 读取权限必须隔离，错误权限配置拒绝启动。

默认 `FilesystemStorageAdapter` 使用三个相互隔离且不在 Web Root 的目录。写入先落到同一文件系统的随机临时文件，完成大小与摘要校验、刷新并关闭后再原子重命名。公开下载经过应用处理器，不暴露主机路径、对象键或目录遍历能力。可选 `S3StorageAdapter` 复用相同 `StoragePort` 契约，仅在显式选择时校验 endpoint、bucket 和凭据。

## 5. API、页面与邮件

API 基础路径为 `/api/v1`。OpenAPI 文档和 TypeScript 客户端由代码确定性生成，并在 CI 中执行 drift 检查。认证使用安全 Cookie 会话、CSRF、Origin/Fetch Metadata、防重放的一次性令牌、重新认证、幂等键和乐观并发版本。统一错误码覆盖认证、权限、状态冲突、流程关闭、校验失败、限流和内部错误；错误响应、日志和任务参数不得包含密码、Cookie、令牌、密钥、分片、遗书正文、对象私钥路径或堆栈。

页面沿用 `前端设计/` 现有视觉基线，并替换所有演示数据为真实 API 路由。覆盖管理员初始化、首页、联系人、文件、设置、恢复、第一阶段确认、第二阶段倒计时、公开遗书、公开 ZIP、公开审计，以及联系人邀请、确认、改密和恢复协助。每页必须实现加载、空数据、离线、401、403、409/423、422、429、5xx 和无障碍状态；关键危险操作同时支持键盘和触屏，确认文字禁止粘贴，密码字段允许密码管理器。

Mailpit 作为本地 SMTP 沙箱。邮件模板中文化并版本化，内容最小化；Worker 负责发送、退避、重试、幂等和失败记录。邮件失败不阻塞公开发布，公开页面和下载仍按数据库状态和截止时间生效。

## 6. 测试、运维与交付门禁

测试分为领域/时间/门限单元测试，加密固定向量与篡改测试，PostgreSQL 迁移/事务/锁/重启恢复集成测试，文件系统与可选 S3 一致性测试，API 权限/CSRF/幂等/日志脱敏测试，Playwright E2E、中文输入、键盘、触屏、200% 缩放和屏幕阅读器验收，以及 Compose 默认 profile 和 `s3` profile 烟测。

完整模拟流程必须可重复执行：初始化 → 联系人激活 → ZIP 上传与激活 → 管理员签到 → 未签到截止 → 联系人确认 → 24 小时发布 → 公开遗书和 ZIP 下载。测试对象、审计、邮件和状态不得进入正式公开空间或改变正式截止时间。

本地 V1 的自动化门禁为：

```text
pnpm check
pnpm test:unit
pnpm test:integration
pnpm test:crypto
pnpm test:storage
pnpm test:e2e
pnpm test:security
pnpm openapi:check
pnpm build
docker compose config --quiet
ops/scripts/compose-smoke.ps1
```

每个门禁记录提交版本、迁移版本、北京时间、测试命名空间、命令、结果和证据路径。完成这些门禁后，只能声明“本地 V1 可运行、可测试、可验收”，不能声明生产安全、法律合规或正式上线。

## 7. 实施顺序与边界

实施沿用现有 7 个计划文件：

1. 工具链、单仓库边界、配置、健康检查、Compose、OpenAPI。
2. 领域模型、数据库迁移、事务仓储和任务持久化。
3. 加密协议、保险库、ZIP 管线和文件存储适配器。
4. 身份、联系人、邀请、签到和门限分片。
5. 死亡确认、密码恢复、通知和最终发布。
6. Web 页面、邮件模板、真实 API 接入和无障碍。
7. 测试模式、E2E、Compose 烟测、重启恢复、验收证据和运维手册。

每个计划包必须先通过自身测试和构建门禁，再进入下一个包；不得以静态页面、演示数据或“可启动空壳”替代真实业务实现。现有未提交的产品、架构、安全、页面、工程和测试文档修改属于项目基线，实施时必须保留并在冲突时同步更新。
