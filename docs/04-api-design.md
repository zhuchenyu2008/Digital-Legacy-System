# Digital Legacy System API 接口设计

> 风格：HTTPS REST + JSON  
> 基础路径：`/api/v1`  
> 字符编码：UTF-8  
> 业务时区：输入输出时间均为 RFC 3339 UTC，同时在展示字段提供北京时间文本  
> 关联文档：[产品需求](./01-product-requirements.md) · [系统架构](./02-system-architecture.md) · [数据库设计](./03-database-design.md) · [安全与隐私](./05-security-privacy.md) · [页面规格](./06-page-specifications.md)

## 1. API 原则

1. 密码、服务端可见令牌、密钥包装和分片只允许出现在 HTTPS 请求体，不允许放入 URL 路径、查询参数、日志或错误响应。邮件入口令牌放在 URL Fragment 中，由前端读取后立即清除 Fragment 并通过 POST 请求体提交，Fragment 不发送给 HTTP 服务器。
2. 认证使用服务端不透明会话和 `HttpOnly; Secure; SameSite=Strict` Cookie，不使用浏览器 `localStorage` 保存令牌。
3. 除登录和安全幂等的读取接口外，所有状态变更请求必须携带 CSRF Token。
4. 确认、取消、激活、恢复、发布相关接口必须携带 `Idempotency-Key`。
5. API 不依赖客户端时间判断截止或阶段，所有决定使用数据库时间。
6. 联系人只能访问自己的资料和当前可参与流程，永远不能枚举其他联系人。
7. 公开 API 只返回脱敏投影，不能复用管理员 DTO。
8. `RELEASED` 后不存在任何删除、替换、撤回或重新隐藏接口。

## 2. 通用协议

### 2.1 请求头

```http
Accept: application/json
Content-Type: application/json
X-CSRF-Token: <session-bound-token>
Idempotency-Key: <UUIDv7>
X-Request-ID: <optional UUIDv7>
```

服务端总是返回 `X-Request-ID`。文件上传到对象存储时使用 API 下发的短期预签名 URL，预签名请求只允许指定对象、方法、大小范围和内容类型。

### 2.2 成功响应

单资源：

```json
{
  "data": {
    "id": "019f...",
    "version": 3
  },
  "requestId": "019f..."
}
```

列表：

```json
{
  "data": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  },
  "requestId": "019f..."
}
```

### 2.3 错误响应

```json
{
  "error": {
    "code": "DLS-WORKFLOW-STATE-CONFLICT",
    "message": "当前流程阶段不允许执行此操作",
    "details": {
      "currentState": "RELEASE_PENDING"
    }
  },
  "requestId": "019f..."
}
```

生产响应不得包含调用栈、SQL、对象键、SMTP 原始响应、密码学材料或内部主机名。

### 2.4 HTTP 状态

| 状态 | 使用场景 |
|---|---|
| `200` | 查询、幂等重放返回既有结果 |
| `201` | 创建邀请、上传会话、测试流程 |
| `202` | 邮件已排队、发布任务处理中 |
| `204` | 登出、无正文操作成功 |
| `400` | 格式错误、确认文字不匹配 |
| `401` | 未认证或密码错误 |
| `403` | 角色无权、CSRF 失败、联系人不在快照 |
| `404` | 资源不存在；对无权资源也统一使用，避免枚举 |
| `409` | 状态/版本/幂等冲突 |
| `410` | 邀请或单次令牌已消费/过期 |
| `413` | 超过部署容量上限 |
| `422` | ZIP 清单、密钥材料或业务校验失败 |
| `423` | 认证临时锁定、流程锁定联系人名单 |
| `429` | 速率限制 |
| `500` | 已脱敏的内部错误 |
| `503` | 数据库/对象存储暂不可用 |

### 2.5 幂等规则

- 相同身份、接口和 `Idempotency-Key` 在 24 小时内重放时返回第一次结果。
- 相同幂等键但请求体摘要不同，返回 `409 DLS-IDEMPOTENCY-PAYLOAD-MISMATCH`。
- 联系人决定、发布锁定和包激活还受数据库唯一约束保护，不只依赖幂等缓存。
- 密码登录、读取和预签名分片上传不共用业务幂等键。

### 2.6 乐观并发

可编辑资源返回：

```http
ETag: "3"
```

更新必须提交：

```http
If-Match: "3"
```

版本不匹配返回 `409 DLS-VERSION-CONFLICT`。

### 2.7 邮件入口令牌

邮件按钮使用类似 `https://example.com/action#token=<base64url>` 的地址。前端启动后必须：

1. 从 Fragment 读取令牌到内存；
2. 立即调用 `history.replaceState` 清除地址栏中的 Fragment；
3. 通过 HTTPS POST 请求体提交令牌；
4. 禁止写入前端日志、错误上报、本地存储、分析事件或 Referrer。

最终公开链接不需要令牌。

## 3. 身份和会话

### 3.1 管理员登录并签到

`POST /auth/owner/login`

```json
{
  "password": "<主密码>"
}
```

成功：

```json
{
  "data": {
    "role": "OWNER",
    "checkedIn": true,
    "beijingDate": "2026-08-01",
    "nextDeadlineAt": "2026-08-04T16:00:00Z",
    "nextDeadlineBeijing": "2026-08-05 00:00:00",
    "workflowCancellation": {
      "cancelled": false,
      "previousState": null
    }
  },
  "requestId": "019f..."
}
```

行为：

- 验证主密码；成功即创建会话并签到。
- 如果是当日重复登录，`checkedIn=true`，但不重复插入签到行。
- 若存在尚可取消的死亡确认/第二阶段或密码恢复流程，在同一事务中取消。
- 若已经达到 `release_at` 或发布锁定，认证可以成功，但返回 `409 DLS-PUBLICATION-IRREVERSIBLE`，不会创建覆盖发布的签到。

限速：每个 IP 与单一管理员组合 15 分钟最多 5 次失败，之后指数退避；成功不应立即清除高风险窗口计数。

### 3.2 联系人登录

`POST /auth/contact/login`

```json
{
  "displayName": "联系人姓名",
  "password": "<联系人密码>",
  "entryToken": "<邮件中的可选入口令牌>"
}
```

`entryToken` 只用于定位当前流程和减少导航，不增加权限。成功后返回该联系人可以参与的流程摘要，但不返回其他联系人数据。

### 3.3 当前会话

`GET /auth/session`

```json
{
  "data": {
    "authenticated": true,
    "role": "CONTACT",
    "actor": {
      "id": "019f...",
      "displayName": "联系人姓名"
    },
    "csrfToken": "<仅响应体提供并绑定会话>",
    "idleExpiresAt": "2026-08-01T10:30:00Z",
    "absoluteExpiresAt": "2026-08-01T18:00:00Z"
  }
}
```

### 3.4 登出

`POST /auth/logout`

吊销服务端会话并清除 Cookie，返回 `204`。

## 4. 初始化和管理员配置

### 4.1 初始化状态

`GET /setup/status`

仅在尚未完成初始化时公开返回必要步骤，不返回邮箱、联系人姓名或文件信息。

```json
{
  "data": {
    "initialized": false,
    "steps": {
      "owner": false,
      "contacts": false,
      "package": false,
      "smtpTest": false,
      "riskAccepted": false
    }
  }
}
```

### 4.2 创建唯一管理员

`POST /setup/owner`

只允许在数据库没有管理员且持有部署时生成的单次 `SETUP_TOKEN` 时调用。

```json
{
  "setupToken": "<部署单次令牌>",
  "displayName": "张三",
  "primaryEmail": "owner@example.com",
  "backupEmail": "backup@example.com",
  "password": "<主密码>",
  "ownerVaultEnvelope": {
    "ciphertext": "<base64url>",
    "nonce": "<base64url>",
    "kdfSalt": "<base64url>",
    "kdfParams": {
      "algorithm": "argon2id",
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1,
      "version": 19,
      "purpose": "owner-vault-kek-v1"
    },
    "keyVerifierCiphertext": "<base64url>",
    "keyVerifierNonce": "<base64url>"
  }
}
```

初始化成功后永久禁用此接口并吊销 `SETUP_TOKEN`。

### 4.3 查询/修改配置

- `GET /owner/settings`
- `PATCH /owner/settings`

修改阈值、显示姓名或邮箱必须输入主密码重新认证。修改未签到阈值后立即按最后签到日重建计划；如果新截止已经过去，事务提交后立即排队触发死亡确认。

```json
{
  "displayName": "张三",
  "primaryEmail": "new-owner@example.com",
  "backupEmail": "new-backup@example.com",
  "missedDaysThreshold": 5,
  "password": "<主密码>"
}
```

### 4.4 接受不可撤回风险并启用

`POST /owner/arm`

```json
{
  "password": "<主密码>",
  "confirmationText": "我理解并接受数字遗产发布后不可撤回",
  "expectedPackageId": "019f...",
  "expectedShareGenerationId": "019f..."
}
```

服务端再次检查至少 3 位有效联系人、SMTP 测试、活动分片代次、活动 ZIP 和 `will.md` 客户端清单。

## 5. 签到与流程

### 5.1 显式签到

`POST /owner/check-ins`

用于管理员已有会话但希望重新输入主密码完成签到，语义与登录签到相同。

```json
{
  "password": "<主密码>"
}
```

### 5.2 当前计划

`GET /owner/check-in-schedule`

```json
{
  "data": {
    "lastCheckInAt": "2026-08-01T10:12:00Z",
    "lastCheckInBeijingDate": "2026-08-01",
    "thresholdDays": 3,
    "deadlineAt": "2026-08-04T16:00:00Z",
    "deadlineBeijing": "2026-08-05 00:00:00",
    "reminders": [
      {"offset": "PT24H", "scheduledAt": "2026-08-03T16:00:00Z", "status": "QUEUED"}
    ]
  }
}
```

### 5.3 管理员查看当前流程

`GET /owner/workflows/current`

管理员可查看联系人逐人投递状态和确认状态，但 API 不返回任何密码学分片。

### 5.4 管理员终止流程

`POST /owner/workflows/{workflowId}/cancel`

```json
{
  "password": "<主密码>",
  "reason": "OWNER_CONFIRMED_ALIVE"
}
```

必须带 `Idempotency-Key`。仅允许：

- `DEATH_CONFIRMING`；
- `RELEASE_PENDING` 且数据库时间严格早于 `releaseAt`、`publishLockedAt` 为空；
- `PASSWORD_RECOVERY`。

成功同时签到。发布锁定或完成后返回 `409 DLS-PUBLICATION-IRREVERSIBLE`。

## 6. 紧急联系人管理

### 6.1 联系人列表

`GET /owner/contacts`

管理员专用。返回状态、姓名、邮箱、注册时间、同意版本和是否已纳入当前分片代次；不返回密码哈希、私钥包装或分片。

### 6.2 创建邀请

`POST /owner/contacts/invitations`

```json
{
  "displayName": "李四",
  "email": "lisi@example.com"
}
```

成功创建 `INVITED` 联系人和 72 小时单次令牌，返回 `202`；邮件异步发送。活动流程期间返回 `423 DLS-CONTACT-LIST-LOCKED`。

### 6.3 重发邀请

`POST /owner/contacts/{contactId}/invitation/resend`

吊销旧令牌，创建新 72 小时令牌。只允许 `INVITED`。

### 6.4 查看邀请信息

`POST /contact-invitations/resolve`

```json
{
  "token": "<邀请令牌>"
}
```

返回管理员显示姓名、预填联系人姓名、知情书全文、版本、摘要和到期时间，不返回其他联系人信息。

### 6.5 接受邀请

`POST /contact-invitations/accept`

浏览器本地生成 X25519 密钥对并加密私钥后提交：

```json
{
  "token": "<邀请令牌>",
  "password": "<联系人密码>",
  "privateKeyEnvelope": {
    "publicKey": "<base64url-32-bytes>",
    "ciphertext": "<base64url>",
    "nonce": "<base64url>",
    "kdfSalt": "<base64url>",
    "kdfParams": {
      "algorithm": "argon2id",
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1,
      "version": 19,
      "purpose": "contact-private-key-kek-v1"
    }
  },
  "consent": {
    "version": "2026-08-01",
    "documentSha256": "<hex>",
    "termsAccepted": true,
    "privacyAccepted": true,
    "denialDisclosureAccepted": true,
    "stage2LockAccepted": true
  }
}
```

注册后联系人进入 `PENDING_KEYING`，直到管理员用主密码生成包含该联系人的新分片代次，才成为有效联系人。

### 6.6 激活联系人变更和新分片代次

`POST /owner/vault/share-generations`

管理员浏览器用主密码解开 `VK`，根据 API 返回的目标联系人公钥生成新分片。

```json
{
  "expectedCurrentGenerationId": "019f...",
  "contactSetVersion": 8,
  "contactCount": 4,
  "deathThreshold": 3,
  "recoveryThreshold": 3,
  "contactsSnapshotSha256": "<hex>",
  "shares": [
    {
      "contactId": "019f...",
      "shareIndex": 1,
      "deathShareCiphertext": "<base64url>",
      "recoveryShareCiphertext": "<base64url>",
      "deathShareCommitment": "<base64url>",
      "recoveryShareCommitment": "<base64url>"
    }
  ]
}
```

服务端重新计算 N 和两个门限，验证每位目标联系人恰好一份、索引唯一、密文尺寸合理，再原子激活。客户端提交的门限值不能作为可信输入。

### 6.7 删除联系人

`POST /owner/contacts/{contactId}/remove`

删除有效联系人必须在同一请求中提交排除该联系人的完整新分片代次，避免出现分片和有效联系人集合不一致：

```json
{
  "password": "<主密码>",
  "expectedCurrentGenerationId": "019f...",
  "contactSetVersion": 8,
  "newGeneration": {
    "contactsSnapshotSha256": "<hex>",
    "shares": [
      {
        "contactId": "<保留的联系人ID>",
        "shareIndex": 1,
        "deathShareCiphertext": "<base64url>",
        "recoveryShareCiphertext": "<base64url>",
        "deathShareCommitment": "<base64url>",
        "recoveryShareCommitment": "<base64url>"
      }
    ]
  }
}
```

服务端重新计算两个门限并原子激活新代次、删除联系人认证材料。删除后有效联系人少于 3 人时请求直接返回 `422 DLS-CONTACT-MINIMUM`，管理员必须先邀请并激活替代联系人。

### 6.8 联系人密码修改邮件

`POST /owner/contacts/{contactId}/password-change-invitation`

创建 24 小时入口令牌并排队发信。令牌不绕过旧密码。

### 6.9 联系人修改密码

`POST /contacts/password-change/resolve`

用于以请求体中的令牌读取当前私钥包装、KDF 参数、公钥和一次性挑战，不返回其他联系人信息。

`POST /contacts/password-change/complete`

```json
{
  "token": "<密码修改入口令牌>",
  "oldPassword": "<旧密码>",
  "newPassword": "<新密码>",
  "newPrivateKeyEnvelope": {
    "ciphertext": "<使用新密码派生密钥重新包装的同一私钥>",
    "nonce": "<base64url>",
    "kdfSalt": "<base64url>",
    "kdfParams": {"algorithm": "argon2id", "purpose": "contact-private-key-kek-v1"}
  }
}
```

服务端验证旧密码和客户端提交的公钥匹配证明后更新。忘记旧密码返回统一错误，不提供恢复路径。

### 6.10 联系人密码学材料

`GET /contact/crypto-material`

联系人会话专用，返回其 X25519 公钥、加密私钥包装、KDF 参数和当前流程对应的加密分片。API 不返回私钥明文。浏览器用本次输入的联系人密码解开私钥，完成后清理内存。

## 7. 保险库和 ZIP

### 7.1 获取浏览器加密材料

`GET /owner/vault/material`

管理员会话专用，返回管理员 `VK` 密钥包装、KDF 参数、当前联系人公钥集合、当前分片代次和算法版本；不返回联系人私钥或任何可直接解密的材料。

高价值调用前要求最近 5 分钟内重新输入过主密码，否则返回 `403 DLS-REAUTH-REQUIRED`。

### 7.2 创建上传会话

`POST /owner/packages/uploads`

```json
{
  "encryptedSize": 123456789,
  "ciphertextSha256": "<hex>",
  "cipherAlgorithm": "XCHACHA20_POLY1305_SECRETSTREAM_V1",
  "streamHeader": "<base64url>",
  "dekEnvelope": "<base64url>",
  "dekEnvelopeNonce": "<base64url>",
  "manifestCiphertext": "<base64url>",
  "manifestNonce": "<base64url>",
  "clientCryptoVersion": "1"
}
```

返回分段上传 ID、固定对象键和短期预签名分片 URL。部署容量上限默认 5GiB，超过返回 `413`。

### 7.3 完成上传

`POST /owner/packages/{packageId}/complete`

```json
{
  "uploadId": "...",
  "parts": [
    {"partNumber": 1, "etag": "..."}
  ],
  "ciphertextSize": 123456789,
  "ciphertextSha256": "<hex>"
}
```

对象存在、大小、摘要和元数据通过后置为 `READY`。失败时保持旧活动包不变。

### 7.4 激活新包

`POST /owner/packages/{packageId}/activate`

```json
{
  "password": "<主密码>",
  "expectedCurrentPackageId": "019f..."
}
```

成功原子替换活动版本并排队删除旧密文。活动流程期间返回 `423 DLS-PACKAGE-LOCKED`。

### 7.5 包列表和上传中止

- `GET /owner/packages`
- `POST /owner/packages/{packageId}/abort`

只能中止 `UPLOADING`/`FAILED` 包。`ACTIVE`、流程快照包和已发布包不能删除。

## 8. 联系人流程接口

### 8.1 获取当前可参与流程

`GET /contact/workflows/current`

死亡首次确认响应：

```json
{
  "data": {
    "workflowId": "019f...",
    "kind": "DEATH_CONFIRMATION",
    "state": "DEATH_CONFIRMING",
    "ownerDisplayName": "张三",
    "startedAt": "2026-08-10T16:00:00Z",
    "decisionAlreadyMade": false,
    "requiredConfirmationText": {
      "deathLikely": "我确认张三已经无法联络，且有很大可能已经离世或已确认离世",
      "alive": "我确认张三仍然健在，并终止本次确认流程"
    },
    "encryptedShare": {
      "purpose": "DEATH",
      "generationId": "019f...",
      "shareIndex": 2,
      "ciphertext": "<base64url>",
      "commitment": "<base64url>"
    }
  }
}
```

API 不返回总联系人名单。公开首页可以显示聚合计数，联系人私有接口不额外暴露逐人状态。

### 8.2 确认可能或已经离世

`POST /contact/workflows/{workflowId}/confirm-death`

```json
{
  "confirmationText": "我确认张三已经无法联络，且有很大可能已经离世或已确认离世",
  "keyFragment": "<base64url-浏览器解密出的分片>",
  "shareIndex": 2,
  "generationId": "019f...",
  "shareCommitment": "<base64url>",
  "clientCryptoVersion": "1"
}
```

服务端对文字执行 Unicode NFC 规范化后要求完全相等；不自动 trim，不接受前后空格、换行或标点差异。成功后销毁联系人浏览器内的明文分片。

响应可能为：

```json
{
  "data": {
    "accepted": true,
    "thresholdReached": true,
    "workflowState": "RELEASE_PENDING",
    "releaseAt": "2026-08-12T08:30:00Z"
  }
}
```

### 8.3 确认仍然健在

`POST /contact/workflows/{workflowId}/confirm-alive`

```json
{
  "confirmationText": "我确认张三仍然健在，并终止本次确认流程"
}
```

成功后流程立即取消、形成代理签到并排队通知所有快照联系人。响应不返回其他联系人邮箱。

进入第二阶段后两个确认接口均返回：

```json
{
  "error": {
    "code": "DLS-CONTACT-ACTION-CLOSED",
    "message": "已进入最终等待阶段，紧急联系人不能再终止或修改流程"
  }
}
```

## 9. 主密码门限恢复

### 9.1 请求恢复启动邮件

`POST /auth/owner/password-recovery/request`

无需提交邮箱，系统向已配置的主邮箱和备用邮箱创建启动邮件。无论是否被限速，公开响应使用相同文案，避免暴露配置状态。

```json
{
  "data": {
    "accepted": true,
    "message": "如果系统已完成配置，启动邮件将被发送"
  }
}
```

限速：每 IP 每 24 小时 3 次，全局每 24 小时 3 次；已有活动恢复流程时只重发未过期入口，不创建并发流程。

### 9.2 启动恢复流程

`POST /auth/owner/password-recovery/start`

```json
{
  "token": "<主或备用邮箱中的单次令牌>"
}
```

成功创建 7 天流程、快照联系人、公开聚合状态并向全部联系人发信。活动死亡确认或第二阶段存在时拒绝。

### 9.3 联系人批准恢复

`POST /contact/workflows/{workflowId}/approve-password-recovery`

```json
{
  "keyFragment": "<base64url>",
  "shareIndex": 2,
  "generationId": "019f...",
  "shareCommitment": "<base64url>",
  "clientCryptoVersion": "1"
}
```

联系人必须已登录且位于快照。达到多数门限后向管理员两个邮箱发送设置新密码链接。

### 9.4 建立一次性密钥重包装会话

`POST /auth/owner/password-recovery/material`

浏览器先生成一次性 X25519 临时密钥对，再提交邮箱重置令牌和临时公钥：

```json
{
  "token": "<单次重置令牌>",
  "clientEphemeralPublicKey": "<base64url-32-bytes>"
}
```

服务端消费邮箱令牌，把临时 `VK` sealed-box 加密给该临时公钥并返回仅可使用一次、15 分钟有效的重包装会话：

```json
{
  "data": {
    "resetSessionToken": "<一次性会话令牌>",
    "encryptedVaultKey": "<base64url>",
    "expiresAt": "2026-08-08T10:15:00Z"
  }
}
```

浏览器解出 `VK` 后立即使用新主密码派生的 `OWNER_KEK` 生成新包装；临时私钥和 `VK` 不进入持久化浏览器存储。

### 9.5 设置新主密码

`POST /auth/owner/password-recovery/reset`

```json
{
  "resetSessionToken": "<一次性重包装会话令牌>",
  "newPassword": "<新主密码>",
  "newOwnerVaultEnvelope": {
    "ciphertext": "<base64url>",
    "nonce": "<base64url>",
    "kdfSalt": "<base64url>",
    "kdfParams": {
      "algorithm": "argon2id",
      "memoryKiB": 65536,
      "iterations": 3,
      "parallelism": 1,
      "purpose": "owner-vault-kek-v1"
    }
  },
  "vaultKeyProof": "<绑定workflowId和新包装的证明>"
}
```

服务端使用仍处于恢复会话中的 `VK` 验证新包装和 `vaultKeyProof`，成功后所有旧会话、启动令牌、重置令牌、重包装会话和临时密钥失效，并记录签到。API 不得返回明文 `VK`。

## 10. 公开接口

### 10.1 公开状态

`GET /public/status`

正常状态：

```json
{
  "data": {
    "state": "NORMAL",
    "message": "Digital Legacy System"
  }
}
```

首次确认：

```json
{
  "data": {
    "state": "DEATH_CONFIRMING",
    "startedAt": "2026-08-10T16:00:00Z",
    "requiredCount": 4,
    "approvedCount": 2,
    "remainingCount": 2
  }
}
```

第二阶段：

```json
{
  "data": {
    "state": "RELEASE_PENDING",
    "releaseAt": "2026-08-12T08:30:00Z",
    "serverNow": "2026-08-11T09:00:00Z"
  }
}
```

客户端倒计时以 `releaseAt - serverNow` 初始化，并定期重新获取；客户端时间不能改变服务端行为。

响应头：

```http
Cache-Control: no-store
X-Robots-Tag: noindex, nofollow, noarchive
```

### 10.2 公开遗书

`GET /public/legacy`

发布前返回 `404`，避免提供空壳资源。发布后：

```json
{
  "data": {
    "ownerDisplayName": "张三",
    "publishedAt": "2026-08-12T08:30:04Z",
    "willHtml": "<p>已经清洗的 HTML</p>",
    "package": {
      "downloadUrl": "/api/v1/public/legacy/package",
      "size": 123456789,
      "sha256": "<hex>"
    },
    "auditFinalHash": "<hex>"
  }
}
```

`willHtml` 是发布时固定并清洗后的内容，不在每次请求时重新渲染。

### 10.3 ZIP 下载

`GET /public/legacy/package`

- 不要求密码或会话。
- 返回稳定公开路由；后端可以流式响应或 302 到短期只读预签名 URL。
- 响应设置 `Content-Type: application/zip`、`Content-Disposition: attachment`、`X-Content-Type-Options: nosniff`。
- 下载路由按 IP 和全局并发限流，支持 Range 请求。
- 发布后 ZIP 不允许替换；ETag 使用公开 SHA-256。

### 10.4 公开审计

`GET /public/legacy/audit?cursor=<opaque>&limit=50`

只返回 `audit.public_events` 的允许字段、链式摘要和当前 ZIP 摘要，不返回联系人身份、IP、设备、邮箱或邮件错误。

## 11. 邮件模板接口

- `GET /owner/email-templates`
- `GET /owner/email-templates/{templateCode}`
- `PUT /owner/email-templates/{templateCode}`
- `POST /owner/email-templates/{templateCode}/preview`
- `POST /owner/email-templates/{templateCode}/reset-default`

修改模板要求管理员会话、最近 5 分钟重新认证和 `If-Match`。服务端只允许该模板声明的占位符；预览不会发送邮件。

### 11.1 SMTP 配置与测试

- `PUT /owner/smtp-settings`
- `POST /owner/smtp-settings/test`
- `GET /owner/notifications?cursor=...`
- `GET /owner/notifications/{notificationId}`

SMTP 密码只允许写入，不允许通过 API 读回；GET 仅返回掩码和配置状态。测试邮件只能发给管理员主/备用邮箱或测试白名单。

## 12. 私有审计接口

- `GET /owner/audit-events?cursor=...&eventType=...&result=...`
- `GET /owner/audit-events/{eventId}`
- `GET /owner/audit-integrity`

管理员可查看解密后的必要私有审计，但密码、令牌、密钥和分片从未被记录，因此不存在对应返回字段。审计只读，无删除 API。

## 13. 测试模式 API

所有测试接口位于 `/simulations`，要求管理员会话和最近重新认证。

- `POST /simulations`：创建隔离测试流程及虚拟时钟。
- `GET /simulations/{id}`：查看测试状态。
- `POST /simulations/{id}/contacts/{contactId}/decision`：以测试凭据模拟联系人决定。
- `POST /simulations/{id}/clock/advance`：推进虚拟时钟。
- `POST /simulations/{id}/mail/fail-next`：模拟 SMTP 失败。
- `GET /simulations/{id}/preview`：查看私有发布预览。
- `DELETE /simulations/{id}`：清理测试数据。

创建请求：

```json
{
  "scenario": "FULL_RELEASE",
  "testRecipients": ["test@example.com"],
  "virtualNow": "2026-08-01T00:00:00Z",
  "speed": 3600
}
```

服务端验证所有测试收件人属于配置白名单。测试对象和预览 URL 永不出现在公开 API。

## 14. 健康接口

- `GET /health/live`：进程存活，不探测依赖。
- `GET /health/ready`：数据库迁移版本、PostgreSQL、任务领取能力和对象存储基本访问。
- `GET /owner/system-health`：管理员查看 Worker 最近心跳、最近截止扫描、任务积压、SMTP 最后测试和对象存储状态。

公开健康接口不返回版本、依赖地址、队列数量或错误详情。

## 15. 主要错误码

| 错误码 | HTTP | 说明 |
|---|---:|---|
| `DLS-AUTH-INVALID-CREDENTIALS` | 401 | 统一账号或密码错误 |
| `DLS-AUTH-LOCKED` | 423 | 临时锁定 |
| `DLS-REAUTH-REQUIRED` | 403 | 高价值操作需重新输入密码 |
| `DLS-CSRF-INVALID` | 403 | CSRF Token 无效 |
| `DLS-RATE-LIMITED` | 429 | 速率限制 |
| `DLS-TOKEN-INVALID` | 404 | 令牌不存在，避免枚举 |
| `DLS-TOKEN-EXPIRED` | 410 | 已过期 |
| `DLS-TOKEN-CONSUMED` | 410 | 已消费 |
| `DLS-CONTACT-LIST-LOCKED` | 423 | 活动流程期间不可修改联系人 |
| `DLS-CONTACT-MINIMUM` | 422 | 有效联系人将少于 3 人 |
| `DLS-CONTACT-ACTION-CLOSED` | 409 | 第二阶段后联系人不可操作 |
| `DLS-CONFIRMATION-TEXT-MISMATCH` | 400 | 确认文字不完全匹配 |
| `DLS-CONTACT-ALREADY-DECIDED` | 409 | 已决定 |
| `DLS-SHARE-GENERATION-MISMATCH` | 409 | 分片代次不一致 |
| `DLS-SHARE-INVALID` | 422 | 分片承诺或重建失败 |
| `DLS-WORKFLOW-STATE-CONFLICT` | 409 | 流程阶段不允许操作 |
| `DLS-WORKFLOW-ALREADY-ACTIVE` | 409 | 已有活动流程 |
| `DLS-PUBLICATION-IRREVERSIBLE` | 409 | 已到期锁定或已发布 |
| `DLS-PACKAGE-LOCKED` | 423 | 包被活动流程快照锁定 |
| `DLS-PACKAGE-INTEGRITY` | 422 | 密文/ZIP 完整性失败 |
| `DLS-ZIP-MANIFEST-INVALID` | 422 | 缺少根目录 `will.md` 等 |
| `DLS-IDEMPOTENCY-PAYLOAD-MISMATCH` | 409 | 幂等键被不同请求体复用 |
| `DLS-VERSION-CONFLICT` | 409 | ETag 版本冲突 |
| `DLS-DEPENDENCY-UNAVAILABLE` | 503 | 关键依赖暂不可用 |

## 16. OpenAPI 与客户端生成要求

- 实现必须维护机器可读 OpenAPI 3.1 文档，本文是业务语义基线。
- 所有请求/响应 DTO 使用严格模式，拒绝未知字段，防止批量赋值。
- `password`、`token`、`keyFragment`、`ciphertext` 字段在 OpenAPI 标记 `writeOnly` 或 `format: byte`，示例使用占位符。
- 客户端类型从 OpenAPI 生成，但密码学结构另有固定版本和测试向量，不能依赖宽松 JSON 类型。
- 破坏性 API 变化必须新建 `/api/v2`；V1 内只允许向后兼容字段新增。
- CI 必须验证 OpenAPI 与控制器一致、没有未声明路由、没有公开管理员 DTO。

## 17. API 安全验收

1. 未认证者无法根据状态码枚举联系人姓名、邮箱或邀请是否存在。
2. 联系人 A 的 Cookie 访问联系人 B 的资源始终返回 404。
3. 邮件入口令牌单独使用不能作出任何确认。
4. 所有状态变更在 CSRF 缺失、错误 Origin 或幂等冲突时拒绝。
5. 手工构造包含正确文字但无有效分片的肯定确认不能增加计数。
6. 联系人否定与门限达到并发时仅有一个事务成功，响应与数据库终态一致。
7. `releaseAt` 到达后，即使发布任务尚未生成公开对象，取消 API 也永久拒绝。
8. 公开 DTO、日志和错误响应不含密钥、私人审计或联系人身份。
9. 测试 API 无法写正式对象前缀、正式通知表或正式 workflow。
10. 发布后 API 路由表中不存在撤回、删除或替换 publication 的操作。
