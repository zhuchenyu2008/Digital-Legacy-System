# Digital Legacy System 数据库设计

> 数据库：PostgreSQL  
> 默认时区：数据库会话使用 UTC，业务展示使用 `Asia/Shanghai`  
> 关联文档：[产品需求](./01-product-requirements.md) · [系统架构](./02-system-architecture.md) · [API 设计](./04-api-design.md) · [安全与隐私](./05-security-privacy.md) · [页面规格](./06-page-specifications.md) · [工程与运维设计](./07-implementation-and-operations.md) · [测试与验收计划](./08-test-and-acceptance-plan.md)

## 1. 设计原则

1. PostgreSQL 是流程状态、截止时间和幂等性的唯一事实来源。
2. 所有时间使用 `timestamptz` 存储 UTC 绝对时间；自然日额外使用 `date` 保存北京时间日期。
3. 主键使用 UUIDv7；本文示例使用 `uuid` 类型，不绑定具体生成扩展。
4. 密码只保存 Argon2id PHC 字符串，不保存明文、可逆密文或快速摘要。
5. 邮箱、姓名、IP、User-Agent 等个人信息使用应用层认证加密；需要唯一查询的值另存 HMAC 盲索引。
6. 遗书 ZIP 不进入数据库，只保存对象位置、密文元数据、密钥包装和摘要。
7. 任何时刻最多存在一个正式活动流程。
8. 流程开始时快照联系人集合、门限、包版本和分片代次，后续不得随配置变化。
9. 发布记录和公开审计记录对应用账号只增不改、不删。
10. 所有异步副作用先写入 Outbox 或持久化任务，再由 Worker 执行。

## 2. PostgreSQL 约定

### 2.1 Schema

```text
app          正式业务表
audit        私有和公开审计表
simulation   测试模式隔离表
pgboss       pg-boss 自有任务表
```

API 和 Worker 使用不同数据库角色：

- `dls_migrator`：仅部署迁移时使用，拥有 DDL 权限。
- `dls_api`：正式业务增改查；无权删除发布数据或读取 pg-boss 内部表。
- `dls_worker`：领取任务、发送邮件和发布；无权修改联系人认证信息。
- `dls_public`：只读公开投影，不可读取私有表。

### 2.2 通用列

除不可变事件表外，主要实体包含：

```sql
id          uuid        primary key,
version     bigint      not null default 0,
created_at  timestamptz not null default clock_timestamp(),
updated_at  timestamptz not null default clock_timestamp()
```

`version` 用于乐观并发。更新语句必须带 `WHERE id = :id AND version = :expected_version`，成功后 `version = version + 1`。

### 2.3 加密字段

应用层加密字段统一拆为：

```text
<field>_ciphertext bytea
<field>_nonce      bytea
<field>_key_version smallint
```

需要唯一判断时增加 `<field>_lookup_hmac bytea`。HMAC 使用独立 `PII_INDEX_KEY`，不能使用普通 SHA-256 直接摘要可猜测的姓名或邮箱。

## 3. 枚举

```sql
create type app.contact_status as enum (
  'INVITED', 'PENDING_KEYING', 'ACTIVE', 'REMOVED'
);

create type app.package_status as enum (
  'UPLOADING', 'READY', 'ACTIVE', 'SUPERSEDED', 'DELETE_PENDING', 'DELETED', 'FAILED'
);

create type app.workflow_kind as enum (
  'DEATH_CONFIRMATION', 'PASSWORD_RECOVERY'
);

create type app.workflow_state as enum (
  'DEATH_CONFIRMING',
  'RELEASE_PENDING',
  'PASSWORD_RECOVERY',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'RELEASED'
);

create type app.workflow_decision as enum (
  'DEATH_LIKELY', 'ALIVE', 'RECOVERY_APPROVE'
);

create type app.notification_status as enum (
  'QUEUED', 'SENDING', 'RETRY_WAIT', 'SENT', 'FAILED', 'CANCELLED'
);

create type app.token_purpose as enum (
  'CONTACT_INVITE',
  'CONTACT_PASSWORD_CHANGE',
  'ADMIN_RECOVERY_START',
  'ADMIN_PASSWORD_RESET',
  'ADMIN_PASSWORD_RESET_CODE',
  'EMAIL_ACTION_ENTRY'
);
```

## 4. 管理员与配置

### 4.1 `app.owner_profile`

单例管理员资料。

| 列 | 类型 | 约束/说明 |
|---|---|---|
| `singleton_id` | `boolean` | PK，固定为 `true`，`check (singleton_id)` |
| `display_name_ciphertext/nonce/key_version` | 加密字段 | 显示姓名 |
| `primary_email_ciphertext/nonce/key_version` | 加密字段 | 主邮箱 |
| `primary_email_lookup_hmac` | `bytea` | 唯一盲索引 |
| `backup_email_ciphertext/nonce/key_version` | 加密字段 | 备用邮箱 |
| `backup_email_lookup_hmac` | `bytea` | 唯一盲索引 |
| `setup_state` | `text` | `INCOMPLETE` / `READY` / `ARMED` |
| `irreversibility_accepted_at` | `timestamptz` | 管理员接受不可撤回风险的时间 |
| `created_at/updated_at/version` | 通用列 |  |

约束：两个邮箱 HMAC 不得相等。

### 4.2 `app.owner_credentials`

| 列 | 类型 | 说明 |
|---|---|---|
| `singleton_id` | `boolean` PK/FK | 对应 `owner_profile` |
| `password_phc` | `text` | Argon2id PHC 字符串 |
| `password_changed_at` | `timestamptz` | 最近改密时间 |
| `password_pepper_version` | `smallint` | 当前认证 pepper 版本 |
| `password_kdf_version` | `smallint` | 认证 KDF 协议版本 |
| `password_normalization_version` | `smallint` | 密码规范化/编码版本 |
| `failed_attempts` | `integer` | 辅助风控，不替代独立速率限制 |
| `locked_until` | `timestamptz` | 临时锁定时间 |
| `credential_version` | `bigint` | 改密后递增，使旧会话失效 |
| `created_at/updated_at` | 时间 |  |

### 4.3 `app.system_settings`

| 列 | 类型 | 说明 |
|---|---|---|
| `singleton_id` | `boolean` PK | 固定为 `true` |
| `timezone` | `text` | 固定 `Asia/Shanghai` |
| `missed_days_threshold` | `integer` | 默认 3，`check >= 1` |
| `contact_consent_version` | `text` | 当前强制知情书版本 |
| `contact_consent_sha256` | `bytea` | 当前文本摘要 |
| `public_base_url` | `text` | 正式站点地址 |
| `test_recipient_allowlist_ciphertext` | `bytea` | 测试收件人白名单 |
| `contact_set_version` | `bigint` | 邀请、注册、激活或删除导致目标集合变化时递增 |
| `settings_version` | `bigint` | 修改后递增 |
| `created_at/updated_at` | 时间 |  |

提醒偏移、确认比例、恢复比例、第二阶段时长和邮件重试序列是代码级不可变业务常量，不开放数据库修改入口。

## 5. 联系人、邀请与同意

### 5.1 `app.emergency_contacts`

| 列 | 类型 | 约束/说明 |
|---|---|---|
| `id` | `uuid` PK | 联系人 ID |
| `status` | `contact_status` | 当前状态 |
| `display_name_ciphertext/nonce/key_version` | 加密字段 | 姓名 |
| `display_name_lookup_hmac` | `bytea` | 活动联系人中唯一；登录查询 |
| `email_ciphertext/nonce/key_version` | 加密字段 | 邮箱 |
| `email_lookup_hmac` | `bytea` | 未删除联系人中唯一 |
| `password_phc` | `text null` | 注册后存在 |
| `password_changed_at` | `timestamptz null` |  |
| `password_pepper_version` | `smallint null` | 当前认证 pepper 版本 |
| `password_kdf_version` | `smallint null` | 认证 KDF 协议版本 |
| `password_normalization_version` | `smallint null` | 密码规范化/编码版本 |
| `credential_version` | `bigint` | 改密后递增 |
| `x25519_public_key` | `bytea null` | 32 字节公钥 |
| `private_key_ciphertext/nonce` | `bytea null` | 联系人密码保护的 X25519 私钥 |
| `private_key_kdf_salt` | `bytea null` | 独立随机盐，至少 16 字节 |
| `private_key_kdf_params` | `jsonb null` | 算法、内存、迭代、并行度、版本 |
| `registered_at` | `timestamptz null` |  |
| `removed_at` | `timestamptz null` | 逻辑删除时间 |
| `created_at/updated_at/version` | 通用列 |  |

部分唯一索引：

```sql
create unique index uq_active_contact_name
  on app.emergency_contacts (display_name_lookup_hmac)
  where status <> 'REMOVED';

create unique index uq_active_contact_email
  on app.emergency_contacts (email_lookup_hmac)
  where status <> 'REMOVED';
```

状态约束：

- `INVITED`：密码、公钥、私钥包装为空。
- `PENDING_KEYING`：注册字段和 `registered_at` 均不为空，但尚未纳入活动分片代次，不计入有效联系人。
- `ACTIVE`：注册字段均不为空，且必须存在于 `active_share_generation_id` 对应的分片集合。
- `REMOVED`：`removed_at` 不为空；认证字段擦除，审计保留不可逆伪名标识。

### 5.2 `app.contact_invitations`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 邀请 ID |
| `contact_id` | `uuid` FK | 联系人 |
| `token_hash` | `bytea unique` | 随机令牌的 HMAC/哈希，只存摘要 |
| `expires_at` | `timestamptz` | 默认创建后 72 小时 |
| `consumed_at` | `timestamptz null` | 单次使用 |
| `revoked_at` | `timestamptz null` | 重发或删除后吊销 |
| `notification_id` | `uuid null` | 对应邀请邮件 |
| `created_at` | `timestamptz` |  |

有效条件：`consumed_at is null and revoked_at is null and expires_at > clock_timestamp()`。

### 5.3 `app.contact_consents`

不可变同意记录。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `contact_id` | `uuid` FK |  |
| `consent_version` | `text` | 知情书版本 |
| `document_sha256` | `bytea` | 完整文本摘要 |
| `terms_accepted` | `boolean` | 流程与不可撤回后果 |
| `privacy_accepted` | `boolean` | 个人信息处理同意 |
| `denial_disclosure_accepted` | `boolean` | 否定时披露姓名邮箱的单独同意 |
| `stage2_lock_accepted` | `boolean` | 第二阶段不可干预 |
| `accepted_at` | `timestamptz` | 服务器时间 |
| `ip_ciphertext/nonce/key_version` | 加密字段 | 同意来源 IP |
| `user_agent_ciphertext/nonce/key_version` | 加密字段 | 同意设备 |

四个布尔值均必须为 `true`。联系人重新邀请后必须重新同意当前版本。

## 6. 保险库、分片与文件

### 6.1 `app.vaults`

系统只有一个活动保险库。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 保险库 ID |
| `owner_vault_envelope` | `bytea` | `OWNER_KEK` 包装后的 `VK` |
| `owner_envelope_nonce` | `bytea` | XChaCha20 nonce |
| `owner_envelope_algorithm` | `text` | 固定允许列表中的 AEAD 算法 |
| `owner_envelope_protocol_version` | `smallint` | 包装协议版本 |
| `owner_envelope_aad_hash` | `bytea` | 实际 AAD 的摘要 |
| `owner_kdf_salt` | `bytea` | 至少 16 字节 |
| `owner_kdf_params` | `jsonb` | Argon2id 参数和用途标签 |
| `vk_commitment` | `bytea` | `SHA-256("dls/vk-commitment/v1" || VK)` |
| `key_verifier_ciphertext` | `bytea` | 固定验证消息的认证密文 |
| `key_verifier_nonce` | `bytea` | 用于验证重建后的 `VK` |
| `active_share_generation_id` | `uuid null` | 当前分片代次 |
| `created_at/updated_at/version` | 通用列 |  |

`key_verifier_ciphertext` 只用于判断重建的 `VK` 是否正确，不泄露 `VK`。

### 6.2 `app.share_generations`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 分片代次 |
| `vault_id` | `uuid` FK |  |
| `generation_no` | `integer` | 单调递增 |
| `contact_count` | `integer` | N，至少 3 |
| `death_threshold` | `integer` | `ceil(N × 0.70)` |
| `recovery_threshold` | `integer` | `floor(N ÷ 2) + 1` |
| `contacts_snapshot_sha256` | `bytea` | 排序后的联系人/公钥摘要 |
| `protocol_version` | `smallint` | 秘密共享协议版本 |
| `vss_scheme` | `text` | 经评审的可公开验证秘密共享方案 |
| `generation_commitment` | `bytea` | 绑定 `vk_commitment` 和两套分片的公开承诺 |
| `status` | `text` | `PREPARING` / `ACTIVE` / `RETIRED` |
| `activated_at/retired_at` | `timestamptz null` |  |
| `created_at` | `timestamptz` |  |

约束：每个 vault 只有一个 `ACTIVE` 代次；阈值必须在 `[2, contact_count]` 范围内。

```sql
create unique index uq_one_active_share_generation
  on app.share_generations (vault_id)
  where status = 'ACTIVE';
```

### 6.3 `app.contact_key_shares`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `generation_id` | `uuid` FK | 分片代次 |
| `contact_id` | `uuid` FK |  |
| `share_index` | `smallint` | Shamir x 坐标，非 0 |
| `death_share_ciphertext` | `bytea` | 使用联系人公钥 sealed-box 加密 |
| `recovery_share_ciphertext` | `bytea` | 独立恢复分片 |
| `share_protocol_version` | `smallint` | sealed-box/分片编码版本 |
| `death_share_commitment` | `bytea` | 带用途标签的摘要/承诺 |
| `recovery_share_commitment` | `bytea` |  |
| `created_at` | `timestamptz` |  |

唯一约束：`(generation_id, contact_id)` 与 `(generation_id, share_index)`。

激活新分片代次的事务必须同时：把被纳入的 `PENDING_KEYING` 联系人改为 `ACTIVE`；把明确移除且未出现在新代次中的联系人改为 `REMOVED` 并擦除认证材料；更新 `vaults.active_share_generation_id`；递增 `contact_set_version`。如果最终有效联系人少于 3 人，整个事务回滚。

### 6.4 `app.legacy_packages`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `version_no` | `integer unique` | 单调递增 |
| `status` | `package_status` |  |
| `object_key` | `text unique` | 私有桶随机对象路径 |
| `upload_id` | `text null` | 分段上传标识 |
| `cipher_algorithm` | `text` | `XCHACHA20_POLY1305_SECRETSTREAM_V1` |
| `stream_header` | `bytea` | secretstream 头 |
| `ciphertext_size` | `bigint` |  |
| `ciphertext_sha256` | `bytea` | 密文摘要 |
| `dek_envelope` | `bytea` | `VK` 包装后的 `DEK_v` |
| `dek_envelope_nonce` | `bytea` |  |
| `dek_envelope_algorithm` | `text` | 包装 AEAD 算法 |
| `dek_envelope_protocol_version` | `smallint` | 包装协议版本 |
| `dek_envelope_aad_hash` | `bytea` | 包装 AAD 摘要 |
| `manifest_ciphertext` | `bytea` | 加密的客户端预检清单 |
| `manifest_nonce` | `bytea` |  |
| `manifest_algorithm` | `text` | manifest 认证加密算法 |
| `manifest_aad_hash` | `bytea` | manifest 绑定包 ID/摘要的 AAD 摘要 |
| `uploaded_at/ready_at/activated_at` | `timestamptz null` |  |
| `superseded_at/deleted_at` | `timestamptz null` |  |
| `created_at/updated_at/version` | 通用列 |  |

部分唯一索引确保最多一个 `ACTIVE` 包：

```sql
create unique index uq_one_active_package
  on app.legacy_packages ((status))
  where status = 'ACTIVE';
```

旧对象删除后保留行、版本、摘要和时间，将 `object_key` 替换为不可解析的删除标记或移入独立历史字段，避免 Worker 再次读取。

## 7. 签到与调度

### 7.1 `app.check_ins`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `beijing_date` | `date` | 业务签到日 |
| `checked_in_at` | `timestamptz` | 实际时间 |
| `source` | `text` | `ADMIN_LOGIN` / `PASSWORD_CHANGE` / `FLOW_CANCEL` / `PASSWORD_RESET` / `CONTACT_ALIVE_PROXY` |
| `actor_type` | `text` | `OWNER` / `CONTACT` |
| `actor_ref` | `uuid null` | 联系人代理签到时存在 |
| `workflow_id` | `uuid null` | 关联流程 |
| `request_id` | `uuid` | 幂等追踪 |
| `created_at` | `timestamptz` |  |

同一自然日只允许一条“有效签到”：

```sql
create unique index uq_checkin_beijing_date
  on app.check_ins (beijing_date);
```

若同日再次登录，只写认证审计，不重复插入签到行。

### 7.2 `app.checkin_schedules`

只保留当前计划和必要历史版本。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `schedule_version` | `bigint unique` | 每次有效签到/阈值修改递增 |
| `last_check_in_id` | `uuid` FK |  |
| `threshold_days` | `integer` | 当次快照 |
| `deadline_at` | `timestamptz` | 触发时间 |
| `reminder_24h_at` | `timestamptz` |  |
| `reminder_12h_at` | `timestamptz` |  |
| `reminder_5h_at` | `timestamptz` |  |
| `reminder_1h_at` | `timestamptz` |  |
| `status` | `text` | `ACTIVE` / `SATISFIED` / `TRIGGERED` / `SUPERSEDED` |
| `created_at/updated_at` | 时间 |  |

最多一个 `ACTIVE` 计划。任务载荷包含 `schedule_version`，旧版本任务执行时必须无副作用退出。

## 8. 正式流程

### 8.1 `app.workflows`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 流程 ID |
| `kind` | `workflow_kind` | 死亡确认或密码恢复 |
| `state` | `workflow_state` | 当前状态 |
| `contact_count_snapshot` | `integer` | N |
| `required_count_snapshot` | `integer` | 当前流程门限 |
| `approved_count` | `integer` | 肯定/恢复确认计数缓存 |
| `share_generation_id` | `uuid` FK | 固定分片代次 |
| `package_id` | `uuid null` FK | 死亡流程固定当前包 |
| `started_at` | `timestamptz` |  |
| `expires_at` | `timestamptz null` | 恢复流程为 7 天；死亡首次流程为空 |
| `release_at` | `timestamptz null` | 第二阶段开始后 +24h |
| `publish_locked_at` | `timestamptz null` | 到期后永久拒绝取消 |
| `ended_at` | `timestamptz null` | 终态时间 |
| `end_reason` | `text null` | 管理员终止、联系人仍健在、过期等 |
| `denying_contact_id` | `uuid null` | 否定者，仅私有 |
| `public_status_version` | `bigint` | 页面缓存 ETag |
| `created_at/updated_at/version` | 通用列 |  |

只允许一个活动正式流程：

```sql
create unique index uq_one_active_workflow
  on app.workflows ((true))
  where state in ('DEATH_CONFIRMING', 'RELEASE_PENDING', 'PASSWORD_RECOVERY');
```

数据库检查约束或触发器必须验证状态与 kind 的组合：

- `DEATH_CONFIRMATION` 只能使用 `DEATH_CONFIRMING`、`RELEASE_PENDING`、`CANCELLED`、`RELEASED`。
- `PASSWORD_RECOVERY` 只能使用 `PASSWORD_RECOVERY`、`COMPLETED`、`CANCELLED`、`EXPIRED`。
- `RELEASE_PENDING` 必须有 `release_at` 和 `package_id`。
- `RELEASED` 必须有 `ended_at`、`publish_locked_at` 和 publication。

### 8.2 `app.workflow_contacts`

流程联系人不可变快照。

| 列 | 类型 | 说明 |
|---|---|---|
| `workflow_id` | `uuid` FK | 联合 PK |
| `contact_id` | `uuid` FK | 联合 PK |
| `share_index` | `smallint` | 当代次分片索引 |
| `display_name_snapshot_ciphertext/nonce` | 加密字段 | 用于通知和争议追溯 |
| `email_snapshot_ciphertext/nonce` | 加密字段 |  |
| `email_snapshot_lookup_hmac` | `bytea` | 投递去重 |
| `created_at` | `timestamptz` |  |

### 8.3 `app.workflow_contact_actions`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `workflow_id` | `uuid` FK |  |
| `contact_id` | `uuid` FK |  |
| `decision` | `workflow_decision` |  |
| `confirmation_text_sha256` | `bytea` | 服务端规范化后文本摘要 |
| `client_signature` | `bytea null` | 如实现联系人签名密钥则保存 |
| `decided_at` | `timestamptz` | 服务器时间 |
| `request_id` | `uuid` | 幂等请求 |
| `ip_ciphertext/nonce/key_version` | 加密字段 |  |
| `user_agent_ciphertext/nonce/key_version` | 加密字段 |  |

唯一约束：`(workflow_id, contact_id)`，保证每人一次决定。

### 8.4 `app.workflow_key_fragments`

只用于门限前的短期/流程期分片收集。

| 列 | 类型 | 说明 |
|---|---|---|
| `workflow_id` | `uuid` FK | 联合 PK |
| `contact_id` | `uuid` FK | 联合 PK |
| `share_index` | `smallint` |  |
| `purpose` | `text` | `DEATH` / `RECOVERY` |
| `fragment_ciphertext` | `bytea` | 按 `purpose` 使用 `RELEASE_STAGE_KEK` 或 `RECOVERY_STAGE_KEK` 认证加密 |
| `fragment_nonce` | `bytea` |  |
| `fragment_protocol_version` | `smallint` | 流程分片包装协议版本 |
| `stage_key_version` | `smallint` | 对应 stage key 版本 |
| `commitment` | `bytea` | 校验对应代次和用途 |
| `received_at` | `timestamptz` |  |

达到门限、流程取消或过期后必须在同一事务中删除。审计只记录“已销毁”事件，不记录内容。

### 8.5 `app.release_secret_sessions`

| 列 | 类型 | 说明 |
|---|---|---|
| `workflow_id` | `uuid` PK/FK |  |
| `purpose` | `text` | `RELEASE` / `PASSWORD_RESET` |
| `vault_key_ciphertext` | `bytea` | 按 `stage_key_purpose` 使用对应 stage key 包装后的 `VK` |
| `nonce` | `bytea` |  |
| `stage_key_purpose` | `text` | `RELEASE` 或 `RECOVERY`，决定使用的 stage key |
| `stage_key_version` | `smallint` | 对应部署密钥版本 |
| `created_at` | `timestamptz` |  |
| `expires_at` | `timestamptz` | 发布截止或恢复截止 |
| `destroyed_at` | `timestamptz null` | 逻辑记录；销毁后密文字段置空 |

`destroyed_at` 非空时，`vault_key_ciphertext` 与 `nonce` 必须为空。

### 8.6 `app.password_rewrap_sessions`

主密码恢复门限达到后，用于把 `VK` 一次性密封给管理员浏览器的短会话。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 重包装会话 ID |
| `workflow_id` | `uuid` FK | 必须为已达到门限的恢复流程 |
| `session_token_hash` | `bytea unique` | 返回浏览器的一次性令牌只存 HMAC |
| `email_code_challenge_id` | `uuid` FK | 已成功消费的主邮箱验证码挑战 |
| `client_ephemeral_public_key` | `bytea` | 一次性 X25519 公钥 |
| `sealed_vault_key_sha256` | `bytea` | 本次返回密文摘要，用于绑定后续证明 |
| `expires_at` | `timestamptz` | 创建后 15 分钟 |
| `consumed_at/revoked_at` | `timestamptz null` | 只能成功一次 |
| `created_at` | `timestamptz` |  |

同一 workflow 最多一个未消费、未吊销且未过期的会话。创建新会话时吊销旧会话；主密码重置、恢复过期或死亡确认启动时全部吊销。

## 9. 会话与单次令牌

### 9.1 `app.auth_sessions`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 会话 ID，不直接作为 Cookie 值 |
| `session_token_hash` | `bytea unique` | Cookie 随机值的 HMAC |
| `token_hmac_key_version` | `smallint` | 计算 HMAC 时使用的密钥版本 |
| `actor_type` | `text` | `OWNER` / `CONTACT` |
| `actor_id` | `uuid null` | OWNER 为空或固定值 |
| `credential_version` | `bigint` | 改密后旧会话失效 |
| `created_at` | `timestamptz` |  |
| `last_seen_at` | `timestamptz` |  |
| `idle_expires_at` | `timestamptz` | 闲置超时 |
| `absolute_expires_at` | `timestamptz` | 绝对超时 |
| `revoked_at` | `timestamptz null` |  |
| `ip_hmac` | `bytea null` | 风险检测，不作硬绑定 |
| `user_agent_hmac` | `bytea null` |  |

### 9.2 `app.one_time_tokens`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `purpose` | `token_purpose` |  |
| `subject_type/subject_id` | `text/uuid` | 联系人、管理员或流程 |
| `token_hash` | `bytea unique` | 只保存令牌 HMAC |
| `token_hmac_key_version` | `smallint` | 计算 HMAC 时使用的密钥版本 |
| `expires_at` | `timestamptz` |  |
| `consumed_at/revoked_at` | `timestamptz null` |  |
| `created_at` | `timestamptz` |  |

令牌消费必须使用单条条件更新：

```sql
update app.one_time_tokens
set consumed_at = clock_timestamp()
where token_hash = :hash
  and purpose = :purpose
  and consumed_at is null
  and revoked_at is null
  and expires_at > clock_timestamp()
returning *;
```

### 9.3 `app.email_verification_codes`

主密码恢复达到联系人门限后创建的主邮箱验证码挑战。验证码只在邮件正文中发送，不出现在 URL、Fragment、任务参数或日志中。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 验证码挑战 ID |
| `purpose` | `text` | 固定为 `ADMIN_PASSWORD_RESET_CODE` |
| `owner_singleton_id` | `boolean` | 固定为 `true` |
| `workflow_id` | `uuid` FK | 当前 `PASSWORD_RECOVERY` 流程 |
| `code_hmac` | `bytea unique` | 8 位验证码的 HMAC，不保存验证码 |
| `token_hmac_key_version` | `smallint` | 计算验证码 HMAC 时使用的密钥版本 |
| `notification_id` | `uuid` | 主邮箱通知 |
| `expires_at` | `timestamptz` | 创建后 10 分钟 |
| `attempt_count` | `smallint` | 错误尝试次数 |
| `max_attempts` | `smallint` | 固定为 5 |
| `consumed_at/locked_at` | `timestamptz null` | 成功消费或尝试耗尽 |
| `created_at` | `timestamptz` |  |

验证码校验必须在事务中执行：锁定挑战行、检查未过期/未消费/未锁定、比较 HMAC、递增失败次数；成功时消费验证码并绑定当前恢复流程。相同挑战的失败次数不能通过更换 IP 或重放请求重置。

## 10. 通知与任务

### 10.1 `app.notifications`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK | 逻辑通知 |
| `template_code` | `text` | 固定模板编号 |
| `recipient_type` | `text` | `OWNER_PRIMARY` / `OWNER_BACKUP` / `CONTACT` |
| `recipient_ref` | `uuid null` | 联系人 ID |
| `recipient_email_ciphertext/nonce` | 加密字段 | 当次收件地址快照 |
| `subject_ciphertext/nonce` | 加密字段 | 邮件标题可能含姓名 |
| `template_data_ciphertext/nonce` | 加密字段 | 模板参数，不含密码/密钥 |
| `status` | `notification_status` |  |
| `idempotency_key` | `text unique` | 业务幂等键 |
| `attempt_count` | `smallint` | 首次发送不计入“重试 7 次” |
| `next_attempt_at` | `timestamptz` |  |
| `sent_at/failed_at` | `timestamptz null` |  |
| `last_error_code` | `text null` | 脱敏错误码 |
| `created_at/updated_at/version` | 通用列 |  |

### 10.2 `app.notification_attempts`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `notification_id` | `uuid` FK |  |
| `attempt_no` | `smallint` | 0 为首次，1..7 为重试 |
| `target_kind` | `text` | `PRIMARY` / `BACKUP` / `CONTACT` |
| `started_at/finished_at` | `timestamptz` |  |
| `result` | `text` | `ACCEPTED` / `TEMP_FAIL` / `PERM_FAIL` |
| `smtp_status_class` | `smallint null` | 仅保存状态类别 |
| `provider_message_id_ciphertext` | `bytea null` | 可选 |
| `error_code` | `text null` | 规范化错误，不存原始敏感响应 |

唯一约束：`(notification_id, attempt_no, target_kind)`。

### 10.3 `app.domain_outbox`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `event_type` | `text` | 领域事件类型 |
| `aggregate_type/id` | `text/uuid` |  |
| `payload` | `jsonb` | 不含秘密和完整个人信息 |
| `idempotency_key` | `text unique` |  |
| `available_at` | `timestamptz` |  |
| `published_at` | `timestamptz null` | 已提交 pg-boss |
| `created_at` | `timestamptz` |  |

业务事务写 Outbox；转发器把事件转为 pg-boss 任务。重复转发由任务幂等键吸收。

## 11. 审计

### 11.1 `audit.private_events`

仅追加表。

| 列 | 类型 | 说明 |
|---|---|---|
| `sequence_no` | `bigserial` PK | 全局顺序 |
| `event_id` | `uuid unique` |  |
| `occurred_at` | `timestamptz` | 服务器时间 |
| `event_type` | `text` |  |
| `actor_type` | `text` | OWNER/CONTACT/SYSTEM/PUBLIC |
| `actor_pseudonym` | `bytea null` | HMAC 伪名，不公开 |
| `target_type/target_id` | `text/uuid null` |  |
| `result` | `text` | SUCCESS/DENIED/FAILURE |
| `request_id` | `uuid null` |  |
| `ip_ciphertext/nonce/key_version` | 加密字段 | 可空 |
| `user_agent_ciphertext/nonce/key_version` | 加密字段 | 可空 |
| `metadata_ciphertext/nonce/key_version` | 加密字段 | 事件细节 |
| `previous_hash` | `bytea` | 前一事件链摘要 |
| `event_hash` | `bytea unique` | 当前链摘要 |

建议摘要：

```text
event_hash = HMAC(AUDIT_CHAIN_KEY,
  previous_hash || canonical_public_fields || ciphertext_hashes)
```

应用数据库角色不得 `UPDATE` 或 `DELETE`。密码、Cookie、令牌、SMTP 凭据、明文 `VK/DEK`、分片和遗书内容禁止进入任何字段。

### 11.2 `audit.public_events`

发布时生成的脱敏不可变投影。

| 列 | 类型 | 说明 |
|---|---|---|
| `publication_id` | `uuid` FK | 联合 PK |
| `sequence_no` | `integer` | 联合 PK，公开顺序 |
| `occurred_at` | `timestamptz` |  |
| `event_code` | `text` | 允许列表中的公开事件 |
| `public_message` | `text` | 不含身份信息 |
| `public_metadata` | `jsonb` | 聚合人数、摘要等允许字段 |
| `previous_hash` | `bytea` | 公开链前值 |
| `event_hash` | `bytea` | 公开链摘要 |

只允许以下事件类型进入公开表：流程触发、聚合确认进度、门限达到、第二阶段提醒汇总、发布锁定、发布完成、ZIP 摘要。

## 12. 发布数据

### 12.1 `app.publications`

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` PK |  |
| `workflow_id` | `uuid unique` FK |  |
| `package_id` | `uuid unique` FK |  |
| `public_slug` | `text unique` | 固定公开路径标识 |
| `public_object_key` | `text unique` | 明文 ZIP 对象 |
| `zip_size` | `bigint` |  |
| `zip_sha256` | `bytea` | 明文摘要 |
| `will_markdown_sha256` | `bytea` | 原始 Markdown 摘要 |
| `will_html_sanitized` | `text` | 清洗后的最终 HTML |
| `public_audit_final_hash` | `bytea` | 公开审计链摘要 |
| `published_at` | `timestamptz` |  |
| `visible_at` | `timestamptz` | 原子公开时间 |
| `created_at` | `timestamptz` |  |

应用层和数据库层均禁止更新/删除。建议触发器：

```sql
create function app.reject_publication_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'publication is immutable';
end $$;

create trigger publications_immutable
before update or delete on app.publications
for each row execute function app.reject_publication_mutation();
```

同类触发器应用于 `audit.public_events`。数据库超级用户仍能绕过或修改底层数据，因此“不可撤回”是应用和正常运维权限下的保证，不是对云平台所有者的物理不可变证明。

## 13. 邮件模板

### 13.1 `app.email_template_overrides`

只保存管理员自定义标题/正文覆盖；缺省使用代码仓库中的受版本控制模板。

| 列 | 类型 | 说明 |
|---|---|---|
| `template_code` | `text` PK | 模板编号 |
| `subject_template_ciphertext/nonce` | 加密字段 |  |
| `body_markdown_ciphertext/nonce` | 加密字段 |  |
| `allowed_variables` | `text[]` | 允许占位符快照 |
| `template_version` | `bigint` |  |
| `updated_at` | `timestamptz` |  |

模板保存时必须解析 AST 并拒绝未知变量、远程图片、脚本、表单和任意 HTML。

## 14. 速率限制

单实例可以使用 PostgreSQL 记录滑动窗口，避免增加 Redis：

### `app.rate_limit_buckets`

| 列 | 类型 | 说明 |
|---|---|---|
| `bucket_key` | `bytea` PK | HMAC(IP + actor + action) |
| `window_started_at` | `timestamptz` |  |
| `attempt_count` | `integer` |  |
| `blocked_until` | `timestamptz null` |  |
| `updated_at` | `timestamptz` |  |

高价值认证仍以 `owner_credentials.locked_until` 和联系人凭据版本作为第二层防护。速率限制记录可定期聚合，但按用户要求不自动删除安全审计事件。

## 15. 测试模式表

测试模式使用 `simulation` schema，禁止 FK 指向正式 workflow 和 publication：

- `simulation.runs`：虚拟时钟、当前状态、创建人、测试收件白名单。
- `simulation.contacts`：从正式联系人创建的不可逆伪名副本，不复制真实密码或私钥。
- `simulation.actions`：模拟确认和否定。
- `simulation.notifications`：模板渲染结果和白名单投递状态。
- `simulation.publications`：私有预览 HTML 和测试对象键。
- `simulation.events`：测试审计。

测试联系人使用仅对该 simulation 有效的随机测试凭据，不能复用正式联系人密码。加速时钟只存储在 `simulation.runs.virtual_now`。

## 16. 核心事务

### 16.1 管理员登录并签到

```text
BEGIN
  锁定 owner_credentials
  验证 Argon2id 和锁定状态
  创建 auth_session
  若当日无 check_in，则插入 check_in
  若当前为 PASSWORD_RECOVERY，则取消恢复并清除分片/令牌
  若当前为 DEATH_CONFIRMING 或 release_at 尚未到期的 RELEASE_PENDING：
      条件更新为 CANCELLED
      清除 workflow_key_fragments / release_secret_session
      写联系人通知 Outbox
  生成新 checkin_schedule，旧计划 SUPERSEDED
  追加私有审计和任务 Outbox
COMMIT
```

如果 `release_at <= clock_timestamp()` 或 `publish_locked_at is not null`，管理员登录仍可认证，但不能签到覆盖发布结果，接口返回不可撤回错误。

### 16.2 联系人肯定确认

```text
BEGIN
  锁定 workflow
  验证 state = DEATH_CONFIRMING、联系人位于快照、尚未决定
  验证确认文字摘要和分片 commitment
  插入 workflow_contact_actions
  按 purpose 使用对应 stage key 加密并插入 workflow_key_fragments
  approved_count += 1
  若 approved_count < required_count：提交
  否则：
      读取并重建 VK，验证 key_verifier
      使用 RELEASE_STAGE_KEK 包装 VK 写 release_secret_sessions
      删除全部 workflow_key_fragments
      state = RELEASE_PENDING
      release_at = clock_timestamp() + interval '24 hours'
      写12个提醒任务和到期发布任务 Outbox
  追加审计
COMMIT
```

### 16.3 联系人确认仍健在

```text
BEGIN
  锁定 workflow
  验证 state = DEATH_CONFIRMING、联系人尚未决定
  插入 ALIVE action
  state = CANCELLED，记录 denying_contact_id 和 ended_at
  删除全部临时分片和令牌
  插入 CONTACT_ALIVE_PROXY check_in
  生成新 checkin_schedule
  写向所有快照联系人的终止通知 Outbox
  追加审计
COMMIT
```

### 16.4 到期发布与管理员终止竞争

发布 Worker 先执行：

```sql
update app.workflows
set publish_locked_at = clock_timestamp(), version = version + 1
where id = :id
  and state = 'RELEASE_PENDING'
  and release_at <= clock_timestamp()
  and publish_locked_at is null
returning *;
```

管理员终止执行：

```sql
update app.workflows
set state = 'CANCELLED', ended_at = clock_timestamp(), version = version + 1
where id = :id
  and state = 'RELEASE_PENDING'
  and release_at > clock_timestamp()
  and publish_locked_at is null
returning *;
```

两者不可能同时成功。发布锁定后即使解密或所选文件存储后端暂时失败，也不能重新开放终止。

### 16.5 激活新 ZIP

```text
BEGIN
  锁定 vault 和当前 ACTIVE package
  验证新包 READY、密文对象存在、摘要和 key envelope 完整
  旧包 -> DELETE_PENDING
  新包 -> ACTIVE
  写 package.delete-old Outbox
  追加审计
COMMIT
```

对象删除在提交后执行，失败可重试；新包激活不能依赖先删除旧对象。

## 17. 索引清单

除主键和唯一约束外至少创建：

```text
check_ins(checked_in_at desc)
checkin_schedules(status, deadline_at)
emergency_contacts(status)
contact_invitations(contact_id, expires_at)
share_generations(vault_id, status)
contact_key_shares(generation_id, contact_id)
legacy_packages(status, version_no desc)
workflows(state, release_at)
workflows(kind, started_at desc)
workflow_contacts(workflow_id)
workflow_contact_actions(workflow_id, decision)
notifications(status, next_attempt_at)
domain_outbox(published_at, available_at)
auth_sessions(session_token_hash)
auth_sessions(actor_type, actor_id, revoked_at)
one_time_tokens(token_hash, purpose)
audit.private_events(occurred_at desc)
audit.public_events(publication_id, sequence_no)
```

## 18. 数据生命周期

| 数据 | 生命周期 |
|---|---|
| 当前加密 ZIP | 直到新版本激活或最终发布 |
| 旧 ZIP 密文 | 新版本激活后异步删除 |
| 当前联系人密码/密钥包装 | 联系人有效期间；删除时擦除认证材料 |
| 已退休分片 | 新代次激活后删除密文，保留摘要审计 |
| 流程临时分片 | 达门限、取消或过期时立即删除 |
| 第二阶段/恢复临时 VK 包装 | 取消、完成或发布后立即密码学擦除 |
| 单次令牌 | 消费/过期后保留摘要和时间，不保留原令牌 |
| 私有审计 | 按用户要求无限期保留 |
| 公开遗书、ZIP、公开审计 | 应用不主动删除，发布后不可变 |
| 测试数据 | 管理员主动清理；与正式数据隔离 |

由于用户明确选择不备份，任何生命周期承诺均以数据库和所选文件存储后端仍可用为前提。

## 19. 迁移要求

- 所有迁移必须可在空数据库一次性执行，并在事务中完成可事务 DDL。
- 枚举新增值、不可变触发器和数据库角色授权必须有自动化迁移测试。
- 禁止生产启动时自动执行破坏性迁移。
- 发布表、公开审计表和私有审计表不得设计 `ON DELETE CASCADE`。
- 联系人、包和流程等业务表使用显式删除/退役状态，禁止数据库级联丢失审计证据。
- 每次迁移记录版本、脚本 SHA-256、开始/结束时间和结果，但不记录连接凭据。

## 20. 迁移交付物与数据库验收

设计落地时，`migrations/` 必须至少包含：

1. schema、枚举、基础表、索引和外键迁移；
2. 应用数据库角色、Worker 角色、公开只读角色和迁移角色授权；
3. 发布表、公开审计表不可变触发器和拒绝删除/更新测试；
4. 业务时间、单例管理员、单个活动流程、单个活动包、单个活动分片代次的约束测试；
5. Outbox/pg-boss 表和幂等唯一约束；
6. 空数据库初始化、重复执行、并发执行和迁移版本校验脚本。

生产部署不得使用拥有 DDL 权限的 API 或 Worker 账号。迁移成功后必须记录迁移版本、脚本摘要和结果；任何失败都要停止发布，不允许服务以半迁移状态启动。
