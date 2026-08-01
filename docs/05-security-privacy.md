# Digital Legacy System 安全与隐私设计

> 文档状态：安全基线  
> 保护对象：遗书 ZIP、密码和密钥、流程状态、联系人个人信息、邮件入口、审计记录  
> 关联文档：[产品需求](./01-product-requirements.md) · [系统架构](./02-system-architecture.md) · [数据库设计](./03-database-design.md) · [API 设计](./04-api-design.md)

## 1. 安全结论

本系统采用“发布前门限保护、门限后受控自动解密”的模型：

- 正常状态和首次确认未达到门限时，数据库、对象存储和部署秘密的离线泄露不足以直接解密遗书 ZIP；仍需管理员主密码或足够联系人实际解包并提交分片。
- 达到死亡确认门限或主密码恢复门限后，服务器必须短期持有由部署密钥包装的保险库密钥，才能在重启后继续 24 小时自动发布或完成重置。该阶段不属于严格零知识。
- 发布后 ZIP 和遗书正文按需求完全公开、无需密码、不可通过系统撤回，保密性目标终止，只保留完整性和可用性目标。
- 网站端加密不能抵御已经控制线上 Web 服务器并篡改 JavaScript 的攻击者；此类攻击者可以等待用户下次输入密码。浏览器端加密主要抵御数据库、对象存储、磁盘快照和静态备份类泄露。
- 系统不启用双因素认证、不做备份、不允许发布后撤回，这些均为管理员明确接受的高风险决策，不得在界面中淡化。

## 2. 安全目标

### 2.1 保密性

1. 发布前，未满足授权条件的主体不能读取 ZIP 明文或保险库密钥。
2. 密码、会话令牌、单次令牌、密钥和分片不得进入日志、URL、邮件或分析系统。
3. 联系人之间默认互不可见，公开页面不披露联系人身份。
4. 私有审计中的 IP、邮箱、姓名和设备信息只能由管理员读取。

### 2.2 完整性

1. 加密 ZIP 的每个分块、顺序和结束标志均必须经过认证。
2. 联系人分片必须绑定分片代次、联系人、用途和流程。
3. 状态迁移必须使用数据库事务、版本条件和幂等键。
4. 发布 ZIP、`will.md` 和公开审计链必须公开 SHA-256 摘要。
5. 私有审计使用链式 HMAC，使删除、插入和修改可被发现。

### 2.3 可用性与安全失效

1. Worker、API 重启不得丢失截止和邮件任务。
2. SMTP 失败不阻塞公开，发布失败不重新开放取消窗口。
3. 关键依赖不可用时禁止仅在内存中推进状态。
4. 无备份条件下不承诺灾难恢复；系统必须把这一点展示给管理员。

### 2.4 隐私

1. 只收集流程和安全所必需的联系人信息。
2. 公开审计是私有审计的脱敏投影，不直接公开原始日志。
3. 否定确认者的姓名和邮箱只按知情书向其他联系人披露，不向公众披露。
4. 联系人同意必须可证明、分项记录且绑定具体文本版本。

## 3. 威胁模型

### 3.1 信任边界

| 边界 | 默认信任 | 说明 |
|---|---|---|
| 管理员浏览器 | 在加载代码未被篡改时受信任 | 持有主密码、`VK` 和上传明文 |
| 联系人浏览器 | 仅信任当前联系人的密码和私钥操作 | 不信任其对死亡事实的真实性 |
| API/Worker | 信任其执行已审核代码 | 达门限后可短期解密 |
| PostgreSQL | 不信任其保密性，信任事务语义 | 数据库泄露不应直接暴露 ZIP |
| 对象存储私有桶 | 不信任其保密性 | 只存认证密文 |
| 对象存储发布桶 | 公开 | 发布后无保密目标 |
| SMTP/邮箱提供商 | 不信任其保密性和可靠送达 | 邮件不含遗书正文、密码或分片 |
| 云主机管理员/root | 高权限威胁 | 能篡改运行代码；无法由普通 Web 加密完全防御 |
| 公众和爬虫 | 敌对 | 可扫描、抓取、转发公开内容 |

### 3.2 主要威胁与控制

| 威胁 | 影响 | 主要控制 | 剩余风险 |
|---|---|---|---|
| 数据库泄露 | 密码破解、PII 泄露、流程情报 | Argon2id、PII 认证加密、HMAC 盲索引、分片密文 | 弱密码仍可能被离线猜测 |
| 私有对象桶泄露 | 遗书内容泄露 | 浏览器 XChaCha20-Poly1305 secretstream | 上传时浏览器或发布阶段被控仍可泄露 |
| 线上服务器/root 被控 | 篡改 JS、窃取下一次密码、提前发布 | 最小权限、只读镜像、CSP、发布审计、部署完整性检查 | 无法由同源 Web 应用彻底消除 |
| 主密码泄露 | 登录、签到、终止、读取文件 | 长口令、Argon2id、限速、敏感操作重认证 | 用户拒绝 MFA，单因子风险保留 |
| 联系人密码泄露 | 伪造该联系人决定、解出一个分片 | 独立密码、限速、每人一次决定、门限 | 多个联系人失陷可达到门限 |
| 联系人合谋 | 提前进入第二阶段或协助接管主密码 | 70% 发布门限、24 小时管理员撤销、恢复需邮箱 | 过半联系人 + 管理员邮箱可重置并读取保险库 |
| 伪造/转发邮件链接 | 诱导或未授权入口 | 链接仅导航、仍需密码、单次短期令牌 | 钓鱼无法完全消除 |
| 暴力破解/撞库 | 账号接管 | Argon2id、长口令、分层限速、通用错误、审计 | 分布式低频攻击仍可能发生 |
| CSRF | 诱导确认/改密/取消 | Strict Cookie、CSRF Token、Origin/Fetch Metadata 校验 | 浏览器/XSS 被控时可绕过 |
| XSS/恶意 Markdown | 窃取操作、公开脚本 | 禁止原始 HTML、清洗、CSP、Trusted Types | 清洗库必须持续升级 |
| ZIP bomb/路径穿越 | 磁盘耗尽、覆盖文件、解析器攻击 | 不落 Web Root、路径规范化、解压额度、只读取 `will.md` | 管理员账号被盗仍可消耗上传带宽 |
| 定时任务丢失/重复 | 未提醒、重复邮件、延迟发布 | PostgreSQL 持久任务、Outbox、幂等键、补偿扫描 | 长期基础设施停机无法补救 |
| 系统时间篡改 | 过早/过晚触发 | PostgreSQL 时间、UTC 截止持久化、NTP | 云主机管理员可同时控制时间和应用 |
| 审计篡改 | 无法追责 | 仅追加权限、链式 HMAC、公开最终摘要 | 数据库超级用户和密钥同时失陷可重写 |
| 公开内容抓取 | 无法撤回、扩散 | `noindex`、下载限流、明确风险提示 | 不能阻止截图、镜像或违规爬虫 |
| 拒绝服务 | 无法签到或取消 | 限流、反向代理、持久状态、部署容量 | 单服务器且无监控/备份，可用性风险较高 |

## 4. 密码安全

### 4.1 密码策略

管理员和联系人密码统一要求：

- 最少 15 个 Unicode 字符，最多 128 个字符；不静默截断。
- 允许空格、中文和所有可打印字符，不强制大小写、数字、符号组合规则。
- 注册/改密时使用本地常见弱密码和泄露密码列表检查；不把密码发送到第三方服务。
- 提供强度提示，但不显示虚假的“绝对安全”或熵保证。
- 不要求定期改密；已知泄露、重置或密钥处理协议升级时必须更改。
- 密码字段允许密码管理器粘贴。只有死亡确认文字字段禁止粘贴，不能把禁止粘贴错误地应用到密码。

用户已选择不启用 MFA，因此最小长度采用无 MFA 场景的较强基线。OWASP 当前建议无 MFA 时少于 15 字符应视为弱密码，并建议最大长度至少允许 64 字符、允许 Unicode/空格、阻止常见泄露密码。[OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

### 4.2 认证哈希

使用 Argon2id，保存标准 PHC 字符串。初始参数：

```text
algorithm   Argon2id v=19
memory      65,536 KiB (64 MiB)
iterations  3
parallelism 1
salt        每个凭据独立随机 16 字节
output      32 字节
pepper      HSM/secret 文件中的独立版本化服务端秘密
```

上线时在最低配置服务器和目标手机浏览器基准测试，目标单次验证约 250–750ms；可提高成本，不得低于 OWASP 当前最低基线 `m=19MiB, t=2, p=1`。RFC 9106 推荐 Argon2id 并建议密码盐使用 16 字节；其低内存通用配置为 64MiB、3 次迭代、4 路并行，本系统因移动浏览器兼容性从 `p=1` 起步并通过实机校准。[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[RFC 9106](https://www.rfc-editor.org/info/rfc9106/)

认证哈希与密钥派生必须使用不同盐、用途标签和输出，禁止把 `password_phc` 当作加密密钥。

### 4.3 密钥派生

管理员 `OWNER_KEK` 和联系人 `CONTACT_KEK` 在浏览器中使用 Argon2id 派生，参数随包装保存并可版本化。关联数据必须包含：

```text
protocolVersion | purpose | actorId | vaultId/contactId | kdfParamsHash
```

改密流程先用旧密钥认证解密，再用新盐和新派生密钥重加密。任何认证失败不得输出“密码正确但密钥损坏”等可区分错误。

### 4.4 暴力破解控制

| 操作 | 限制 |
|---|---|
| 管理员登录/签到 | IP + 单例账号：15 分钟 5 次失败，指数退避，最长锁定 24 小时 |
| 联系人登录 | IP + 姓名盲索引：15 分钟 5 次；IP 全局 30 次 |
| 联系人决定 | 每流程每联系人一次；失败认证仍计入登录限制 |
| 忘记主密码请求 | 每 IP 每日 3 次，全局每日 3 次 |
| 邀请令牌尝试 | 每 IP 每小时 20 次；令牌至少 256 位随机 |
| ZIP 下载 | 每 IP 并发和带宽限制；不限制正常 Range 续传 |

错误文案和可观察响应时间尽量一致，避免根据“姓名不存在、密码错误、已锁定”枚举联系人。

## 5. 文件与密钥保护

### 5.1 文件加密

- 每版 ZIP 使用浏览器 CSPRNG 生成独立 256 位 `DEK_v`。
- 使用 libsodium `crypto_secretstream_xchacha20poly1305` 分块认证加密；每个流拥有随机头，最后一块必须带 `TAG_FINAL`。
- `DEK_v` 使用 256 位 `VK` 认证加密包装，关联包 ID、版本、算法版本和密文摘要。
- 私有对象存储只保存密文、非秘密流头和必要元数据。
- 发布时任何分块认证失败、流截断、乱序或缺少 FINAL 标签都必须终止发布，不输出部分明文。

XChaCha20-Poly1305 提供机密性和认证标签，随机长 nonce 适合该场景；libsodium secretstream 额外处理大文件分块、顺序和结束标志。[libsodium XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305)、[secretstream](https://doc.libsodium.org/secret-key_cryptography/secretstream)

OWASP 建议静态敏感数据使用认证加密模式并实行独立密钥生命周期，密码哈希与可逆数据加密应分开处理。[OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

### 5.2 联系人公私钥

- 联系人浏览器生成 X25519 密钥对。
- 公钥明文保存；私钥由联系人密码派生的 `CONTACT_KEK` 使用 XChaCha20-Poly1305 包装。
- Shamir 分片使用对应联系人公钥 sealed-box 加密。
- 私钥解开和分片解包在浏览器完成；浏览器提交明文分片后立即覆盖相关内存缓冲区并清空表单。
- 浏览器和 JavaScript 垃圾回收不能保证物理内存立即擦除，文档和 UI 不作绝对保证。

### 5.3 门限秘密共享

- 使用经过安全评审、支持 32 字节秘密和明确有限域实现的库，不自行编写密码算法。
- 死亡发布和密码恢复使用不同随机多项式、用途标签、commitment 和分片集合。
- 门限由服务端基于流程快照重新计算，拒绝客户端自报值。
- 分片必须绑定 `generationId`、`contactId`、`shareIndex`、`purpose` 和 `vaultId`。
- 少于门限时不尝试猜测或恢复；达到门限后验证 `VK` 的认证验证块。
- 临时分片在数据库中只以 `STAGE_KEK` 加密保存，达门限、取消或过期后立即删除。

### 5.4 服务器部署密钥

使用相互独立、版本化的秘密：

```text
STAGE_KEK       包装门限重建后的临时 VK
PII_KEK         加密姓名、邮箱、IP、User-Agent
PII_INDEX_KEY   生成姓名/邮箱盲索引
TOKEN_HMAC_KEY  单次令牌和会话令牌摘要
AUDIT_CHAIN_KEY 私有审计链 HMAC
PASSWORD_PEPPER 认证哈希纵深保护
```

要求：

- 通过 Docker Secret、只读 root-owned 文件或云秘密管理服务注入，不直接写普通环境变量。
- 文件权限仅 API/Worker 对应 UID 可读；容器以非 root 运行。
- 每项秘密独立生成至少 256 位随机值，不能从主密码或同一根字符串派生。
- 数据库记录密钥版本，不记录密钥本身。
- 轮换 `PII_KEK` 时后台逐条重加密；轮换索引键需要双写和重建索引。
- 轮换 `STAGE_KEK` 前必须处理所有活动发布/恢复会话；旧版本保留到这些会话结束。
- 无备份意味着密钥文件丢失会永久破坏对应数据；这是用户已接受风险。

### 5.5 密码学信任边界

“没有密码无法解密”具体定义为：在正常状态或首次确认尚未达到门限时，攻击者只得到数据库、私有对象桶和部署 secret 文件，仍不能恢复 `VK`。以下情况不在该保证内：

- 攻击者控制线上 Web/API 并捕获用户随后输入的密码；
- 已有足够联系人主动提交分片；
- 已进入第二阶段或密码恢复门限已达到；
- 管理员设备、联系人设备或浏览器扩展本身失陷；
- 过半联系人、管理员邮箱或部署管理权限按恢复流程组合被控制。

## 6. 主密码恢复的特殊风险

主密码恢复门限为“超过一半”，低于死亡发布的 70% 门限。恢复成功者可以设置新主密码，而主密码又可以读取保险库和终止流程。因此：

- 控制管理员主/备用邮箱之一并控制过半联系人，可接管管理员账号并读取遗书，低于死亡发布门限。
- 只控制过半联系人但没有管理员邮箱，不能设置新密码；只控制邮箱但没有联系人门限，也不能恢复。
- 服务端在恢复门限达到后短期持有 `VK`，其运行环境被控时可以读取遗书。
- 恢复开始必须由管理员邮箱单次链接触发，公开按钮不能直接进入联系人投票。
- 恢复链接 7 天过期；成功或过期后销毁所有分片、令牌和临时密钥。
- 恢复流程不暂停死亡截止，防止攻击者借恢复流程无限阻止发布。
- 达到门限后，管理员浏览器生成一次性 X25519 临时密钥对；服务器仅把 `VK` sealed-box 加密给该临时公钥。浏览器用新主密码重包 `VK` 后立即销毁临时私钥和明文 `VK`，重包装会话最长 15 分钟且只能使用一次。

这是用户选择的恢复可用性与发布门限之间的固有权衡。

## 7. 身份、会话与敏感操作

### 7.1 会话

会话 Cookie：

```http
Set-Cookie: __Host-dls_session=<random>; Path=/; Secure; HttpOnly; SameSite=Strict
```

- 会话值至少 256 位 CSPRNG，数据库只存 HMAC。
- 管理员空闲 15 分钟、绝对 8 小时；联系人空闲 15 分钟、绝对 2 小时。
- 登录、权限变化、改密和恢复成功后轮换会话 ID。
- 改密后通过 `credential_version` 吊销该主体的全部旧会话。
- 不把 Cookie、会话 ID 或 CSRF Token 写入日志。

OWASP 建议 Cookie 使用 `Secure`、`HttpOnly`、`SameSite`，并明确不应把认证令牌存入 `localStorage`/`sessionStorage`。[OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

### 7.2 CSRF

所有状态变更同时要求：

- `SameSite=Strict` 会话 Cookie；
- 与会话绑定的 CSRF Token；
- `Origin` 严格等于正式站点；
- `Sec-Fetch-Site` 为 `same-origin`；
- JSON `Content-Type`，拒绝简单表单编码。

邮件链接只执行 GET 导航或令牌检查，不能直接确认、取消、改密或发布。

### 7.3 重新认证

以下操作要求最近 5 分钟内重新输入对应密码：

- 管理员上传/激活 ZIP、查看保险库材料、修改联系人、修改邮箱/阈值/SMTP、改主密码、终止流程、查看完整私有审计；
- 联系人作出死亡/存活决定、批准主密码恢复、修改密码。

第二阶段每次终止都必须重新输入主密码，不接受仅凭现有会话取消。

## 8. Web 与内容安全

### 8.1 安全响应头

建议生产基线：

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests; require-trusted-types-for 'script'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Robots-Tag: noindex, nofollow, noarchive
```

公开 ZIP 下载可在独立子域返回 `Cross-Origin-Resource-Policy: cross-origin`，但不得携带会话 Cookie。

### 8.2 Markdown

- 禁用 Markdown 原始 HTML、iframe、script、style、表单和远程图片。
- 链接协议只允许 `https:`、`http:`、`mailto:`；外链增加 `rel="noopener noreferrer nofollow"`。
- Markdown 转 HTML 后使用持续维护的 DOMPurify/sanitize-html 允许列表再次清洗。
- React 不得直接把未清洗内容交给 `dangerouslySetInnerHTML`。
- 发布时固定清洗结果，公开请求不重新执行解析器。

OWASP 指出框架自动转义并不足以覆盖所有 XSS 场景，富文本必须使用专门 HTML 清洗，并建议 DOMPurify。[OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)

### 8.3 禁止粘贴确认文字

- 前端拦截 `paste`、`drop`、`beforeinput` 中粘贴类型和自动填充。
- 每次输入动态显示目标文字，但不提供可选择的复制按钮。
- 服务端对输入执行 Unicode NFC 后完全匹配，不 trim，不忽略标点。
- 禁止粘贴是促使联系人停顿阅读的交互措施，不是安全认证因素；开发者工具、辅助技术或定制客户端可以绕过。
- 密码输入必须允许粘贴，以兼容密码管理器。

### 8.4 CORS 与第三方资源

- 正式 API 仅允许同源，不启用通配 CORS。
- 页面不加载第三方脚本、字体、统计、广告、头像或追踪像素。
- 邮件模板不包含远程追踪图片。
- 公共页面避免向第三方发送 Referrer。

## 9. 上传与发布安全

### 9.1 上传

- 文件扩展名、MIME 和 ZIP 魔数都要检查，但均不能单独作为信任依据。
- 上传使用随机对象键，私有桶禁止执行和公开读取。
- 分段上传限制单片大小、总大小、并发数和有效期。
- 新包在全部密文到达、摘要一致和元数据完整前不能激活。
- 活动流程期间锁定包版本，避免确认对象和最终发布对象发生切换。

### 9.2 ZIP 解析

- 在隔离 Worker 中以非 root 用户解析。
- 拒绝 ZIP64 异常值、重叠条目、加密嵌套 ZIP、路径穿越、绝对路径、设备名、符号链接和重复规范化文件名。
- 只读取根目录精确 `will.md`，上限 2MiB；不解码或预览视频。
- 声明解压总量不得超过压缩大小 100 倍或配置容量；条目不超过 10,000。
- 临时明文只写独立暂存对象或受限临时目录，成功后原子公开，失败立即删除。
- 下载固定 `Content-Disposition: attachment` 和 `nosniff`。

OWASP 将恶意解析器输入、ZIP bomb、路径穿越和公开下载流量放大列为主要上传威胁，并建议把上传文件放在 Web Root 之外。[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

### 9.3 不可撤回实现

- 24 小时到期由条件更新写入 `publish_locked_at`；从该时刻起 API 永久拒绝取消。
- 发布表和公开审计表设置拒绝 UPDATE/DELETE 的触发器，应用账号没有对应权限。
- 发布对象使用独立桶/前缀和只增权限；如供应商支持，可启用 Object Lock Legal Hold。
- 不配置生命周期清理规则。
- 不提供 UI、API、后台命令或普通数据库角色的撤回路径。

数据库超级用户、云平台所有者和存储供应商在技术上仍可能删除底层数据，因此不可撤回是正常系统权限下的产品保证，而不是抗基础设施所有者的数学保证。

## 10. 邮件安全

- 强制 SMTP over TLS：优先隐式 TLS 465 或 STARTTLS 587，并验证证书；禁止明文回退。
- SMTP 凭据写入只读 secret，不可由 API 读回。
- 建议域名配置 SPF、DKIM 和 DMARC；模板使用固定 From，避免伪造和垃圾邮件评分。
- 所有动作链接使用至少 256 位随机单次令牌，令牌只存 HMAC、带目的和到期时间。
- URL 不包含姓名、邮箱、状态、密码、流程决定或密钥材料。
- 除最终公开链接外，邮件入口不能直接改变任何状态。
- 邮件正文不包含遗书、ZIP、联系人名册、密码、分片或私人审计。
- 否定终止邮件是唯一联系人披露例外，只发送否定者姓名和邮箱给当次快照中的其他联系人。
- 主邮箱 SMTP 明确失败后立即尝试备用邮箱；“SMTP 接受”不代表收件箱实际可见。

## 11. 日志与审计安全

### 11.1 必须审计

- 认证成功/失败、锁定和会话吊销；
- 签到、截止计划和提醒；
- 邀请、注册、同意书、删除和重分片；
- 文件上传、摘要验证、激活和旧对象删除；
- 流程创建、每次决定、门限达到、取消、过期、发布锁定和发布；
- 密钥重建成功/失败、临时密钥创建/销毁；
- SMTP 尝试和规范化结果；
- 测试模式创建、推进和清理；
- 管理配置和安全参数变化。

### 11.2 禁止记录

- 密码及其局部内容；
- Cookie、Session ID、CSRF Token、邀请/重置令牌；
- `VK`、`DEK`、`STAGE_KEK`、联系人私钥或 Shamir 分片；
- SMTP 密码、数据库连接串；
- ZIP 明文、遗书正文或 Markdown 原文；
- 完整请求/响应体；
- 未经清洗的 SMTP 原始错误或用户输入换行符。

OWASP 日志指南明确建议对会话标识、访问令牌、密码、加密密钥和个人信息删除、掩码、加密或去标识化，并防止日志注入。[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

### 11.3 公开审计

发布时从私有事件生成允许列表投影，只公开：

- 流程触发时间；
- 所需人数、已确认人数和门限达到时间；
- 第二阶段开始、提醒计划和发布锁定时间；
- 最终发布时间；
- ZIP 和 `will.md` 摘要；
- 公开审计链摘要。

不公开联系人姓名、邮箱、IP、User-Agent、单人决定明细、SMTP 错误和内部对象路径。

## 12. 隐私设计

### 12.1 数据清单

| 数据 | 目的 | 可见范围 | 保存 |
|---|---|---|---|
| 管理员姓名 | 页面、确认文字、邮件 | 联系人；发布后公众 | 不主动删除 |
| 管理员主/备用邮箱 | 提醒、恢复 | 管理员、Worker | 系统运行期间 |
| 联系人姓名/邮箱 | 邀请、登录、通知、否定披露 | 管理员；否定时其他联系人 | 活动期间；私有审计长期 |
| 密码哈希 | 身份认证 | 认证模块 | 凭据有效期间 |
| 联系人公钥/私钥包装 | 门限分片 | Vault 模块、联系人本人 | 联系人有效期间 |
| IP/User-Agent | 防滥用、审计 | 管理员私有审计 | 按需求无限期 |
| 联系人决定 | 门限和争议追溯 | 管理员；公众仅聚合 | 按需求无限期 |
| ZIP 密文 | 遗产保管 | 对象存储；授权加密流程 | 当前版本期间 |
| 发布 ZIP/遗书 | 公开遗产 | 公众 | 应用不主动删除 |

### 12.2 同意

联系人注册必须保存四项独立同意和完整文本摘要：流程/不可撤回、一般个人信息处理、否定时姓名邮箱披露、第二阶段不可干预。任何一项未同意均不能成为联系人。

中国《个人信息保护法》第二十五条规定，公开个人信息原则上需要取得单独同意；第十四、十七条要求同意在充分知情下自愿明确作出并告知处理目的、方式、种类和保存期限。[《中华人民共和国个人信息保护法》](https://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)

该法第七十二条规定，自然人因个人或家庭事务处理个人信息时不适用该法。本项目是否始终属于该例外，取决于实际运营范围、公开方式和是否向他人提供服务，不能只凭“单用户”自动认定。设计仍按知情、最小必要、单独同意和安全保护原则实施；若未来扩展为对外服务，必须重新进行法律评估。

### 12.3 撤回与联系人退出

- 联系人可通过知情书中提供的管理员联系方式请求退出。
- 正常状态下，管理员删除联系人并重新生成分片；删除后擦除其认证材料和当前 PII，审计保留伪名化事件及已发生处理事实。
- 活动流程中名单锁定。联系人希望退出时可在首次阶段选择“仍然健在”终止流程，随后由管理员删除；第二阶段按已确认规则不能由联系人终止。
- 已经发送给其他联系人的否定披露邮件和已经公开的内容无法追回；知情书必须说明。
- 如果系统运营已超出个人/家庭事务，退出和数据保留流程应由中国执业律师复核。

### 12.4 境外部署

服务器位于中国大陆以外，用户明确要求本设计不展开具体地区、备案和跨境合规方案。部署者仍需自行确认实际服务器所在地、管理员和联系人所在地、SMTP/对象存储供应商以及跨境提供个人信息的适用要求。本文件不构成法律意见。

## 13. 基础设施加固

- Linux 主机仅开放 22（限制来源）、80、443；SSH 禁止密码登录和 root 直登。
- 容器使用非 root UID、只读根文件系统、删除非必要 Linux capabilities、设置 CPU/内存/PID 限额。
- PostgreSQL 和对象存储凭据分别授予最小权限；API 与 Worker 账号分离。
- 镜像使用固定 digest；CI 生成 SBOM、依赖漏洞扫描和 secret 扫描结果。
- 生产构建禁止 source map 公开访问、调试端点和详细错误页。
- 数据库参数化查询；ORM 禁止字符串拼接 SQL。
- 反向代理限制请求头、URL、JSON 请求体和并发连接大小。
- 定期更新 Node.js、Next.js、NestJS、libsodium、Markdown 解析器和清洗库。
- 用户不要求主动监控，但健康页、结构化日志和任务心跳仍必须存在。

## 14. 安全测试

### 14.1 自动化

- SAST、依赖漏洞扫描、许可证检查、secret 扫描；
- OpenAPI 未认证路由和角色授权测试；
- SQL 注入、XSS、CSRF、SSRF、路径穿越和批量赋值回归；
- Argon2id 参数降级检测和密码日志泄露测试；
- 密文篡改、流截断、分块重排、nonce 重用测试；
- Shamir 少于门限、混用代次、混用用途和重复 shareIndex 测试；
- 并发确认、否定、取消和发布竞争测试；
- 测试模式跨命名空间写入阻断测试；
- 发布后删除/更新 API 和数据库权限测试。

### 14.2 人工评审

- 密码学协议和浏览器端实现必须由具备应用密码学经验的人复核。
- 发布状态机和数据库事务必须进行并发代码评审。
- 上线前进行一次覆盖认证、流程越权、文件上传、业务逻辑和密钥边界的渗透测试。
- 使用真实 SMTP 沙箱和对象存储测试重启恢复、延迟与失败路径。
- 紧急联系人知情书和遗嘱法律定位由中国执业律师复核。

## 15. 安全事件处理

即使不接入主动监控，也需要预定义处理方式：

| 事件 | 立即措施 |
|---|---|
| 怀疑主密码泄露 | 管理员登录改密、重包 `VK`、吊销会话、检查审计；若流程活动则先终止 |
| 联系人密码泄露 | 正常状态删除并重新邀请，生成新分片代次 |
| SMTP 凭据泄露 | 轮换 SMTP 密码，检查投递记录和伪造邮件 |
| PII 密钥泄露 | 轮换 `PII_KEK`/索引键并重加密，评估联系人通知 |
| `STAGE_KEK` 泄露 | 轮换；检查是否存在活动第二阶段/恢复会话和异常解密审计 |
| 数据库泄露 | 轮换 pepper、令牌/HMAC/PII 密钥，强制改密并重新分片 |
| Web 供应链/脚本篡改 | 立即下线写操作，轮换所有用户密码和密钥包装，重新上传 ZIP |
| 误入首次确认 | 管理员用主密码终止；或联系人选择仍健在 |
| 已过 24 小时误发布 | 系统无撤回能力；只能进行外部法律和平台协调，不能承诺删除副本 |

## 16. 上线安全门禁

以下任一项未通过，不得把系统置为 `ARMED`：

1. TLS、HSTS、Cookie、CSP 和 CSRF 自动测试通过。
2. Argon2id 参数达到基线，所有密码和密钥字段经过日志泄露测试。
3. 至少 3 名联系人完成当前知情书并纳入活动分片代次。
4. 任意少于死亡/恢复门限的分片组合均不能重建 `VK`。
5. 加密 ZIP 篡改、截断和错序均被拒绝。
6. ZIP 根目录 `will.md` 验证、路径穿越和 ZIP bomb 防护通过。
7. 管理员取消与到期发布的并发测试只产生一个终态。
8. 第二阶段后联系人所有终止接口均被拒绝，且知情书包含该条款。
9. 最终邮件只包含公开链接，不附 ZIP；SMTP 失败不阻塞发布。
10. 公开 API 和公开审计不含联系人身份及私有日志字段。
11. 测试模式收件白名单和对象前缀隔离通过。
12. 发布表、公开审计和公开对象不存在普通应用权限下的删除路径。
13. 管理员再次确认无 MFA、无备份、发布不可撤回和法律效力不保证的风险。

## 17. 权威参考

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [RFC 9106: Argon2 Memory-Hard Function](https://www.rfc-editor.org/info/rfc9106/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [libsodium secretstream](https://doc.libsodium.org/secret-key_cryptography/secretstream)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [《中华人民共和国民法典》继承编相关条文](https://gongbao.court.gov.cn/Details/7f184078694d811fb3314f6af9accf.html)
- [《中华人民共和国电子签名法》](https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_e3f623f70c23497e88a941170093446a.html)
- [《中华人民共和国个人信息保护法》](https://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)
