# 计划 5：工作流、通知与不可变发布验收证据

验收时间：2026-08-09 11:30:50（北京时间，`Asia/Shanghai`, UTC+08:00）。

验收基线提交：`a375b8da63bf6ffbc30e03d44ebc0c6892b71bd4`。本记录只把本次实际执行且退出码为 0 的门禁标记为通过。

## 规定门禁

| 北京时间 | 命令 | 结果 |
| --- | --- | --- |
| 2026-08-09 11:23 | `pnpm.cmd test:integration` | 通过；18 个测试文件，48/48 测试通过 |
| 2026-08-09 11:29 | `pnpm.cmd exec vitest run tests/concurrency` | 通过；7 个测试文件，10/10 测试通过 |
| 2026-08-09 11:29 | `pnpm.cmd exec vitest run tests/faults` | 通过；1 个测试文件，20/20 测试通过 |
| 2026-08-09 11:30 | `pnpm.cmd openapi:check` | 通过；API 文档与生成客户端均无漂移 |
| 2026-08-09 11:30 | `pnpm.cmd build` | 通过；12 个可构建工作区项目完成，包含 web 生产构建及 API/worker TypeScript 构建 |

补充证据命令：

```powershell
pnpm.cmd exec vitest run tests/integration/key-capabilities.test.ts `
  packages/application/src/notifications apps/worker/src/notifications `
  tests/integration/notifications-mailpit.test.ts tests/integration/publication.test.ts
```

结果：5 个测试文件，13/13 测试通过。该套件用于集中复核能力隔离、通知重试/回退与真实 SMTP 投递、公开对象和数据库发布记录对账。

## 阈值与竞态证据

- 死亡工作流启动只使用持久化的 owner、设置、活动 generation、活动包、联系人和共享快照；重复到期评估只创建一个正式工作流。
- 20 个同时肯定请求只推进一次阈值状态，`approved_count` 不超过快照阈值，联系人最终决策唯一，版本/outbox 与获胜事务一致。
- 同一联系人同时提交 `ALIVE` 与死亡肯定时只持久化一个最终决策；取消不会倒减已经持久化的批准计数。
- 20 个取消与发布截止锁定请求竞争时，行锁获胜者决定唯一结果；截止后恰好一个 `publish_locked_at`，截止前恰好一次取消且没有发布锁。
- 密码恢复与死亡启动竞争时，死亡流程可按优先级取消活动恢复并销毁暂存材料；密码重置完成与死亡启动恰好一个获胜，另一方安全返回 stale/受控冲突。
- 共享代次并发激活保持一个 `ACTIVE` generation，vault 指针与获胜代次一致。
- 直接目录门禁现在在启动时清理严格标记的中断并发夹具，并将测试文件串行；每个文件内部的真实多客户端竞态保持不变。原始计划命令无需额外参数即可重跑。

## 密钥能力启动证据

`tests/integration/key-capabilities.test.ts` 的 4 项测试验证：

- API 只有死亡入口公钥、恢复入口密钥对和恢复暂存 KEK；不持有死亡入口私钥或死亡暂存 KEK。
- worker 只有死亡入口密钥对和死亡暂存 KEK；不持有任何恢复私钥或恢复暂存 KEK。
- 任一禁止的交叉进程 secret 挂载都会 fail closed。
- 缺失、非规范 Base64、非 32 字节、非正版本和不匹配的 X25519 公私钥都会阻止启动。

挂载、排空式轮换、健康信号、丢失后果和同版本恢复流程记录在 `docs/operations/stage-key-capabilities.md`。文档不含密钥值。

## 通知失败与重启证据

- 通知创建在事务内冻结模板版本、主/备用收件地址与渲染数据，数据库只持久化加密快照。
- 严格 Handlebars 渲染拒绝缺失/多余变量；HTML 经样式内联并保持安全转义，纯文本正文保留完整链接，时间按北京时间渲染。
- SMTP 临时失败按有界退避重试，最多 7 次；永久失败按策略切换允许的备用地址。密码恢复通知明确禁止备用地址回退。
- provider message ID 加密持久化；接受、临时失败和永久失败均形成独立 attempt 记录，任务重启后从数据库状态继续。
- `tests/integration/notifications-mailpit.test.ts` 使用真实 SMTP 协议向 Mailpit 投递并核对主题、HTML、纯文本和链接，而不是只验证 mock。

## 不可变发布与故障矩阵

发布管线在非 web root 暂存区以有界背压流完成：精确版本的发布暂存 KEK 解开 VK，VK 解开包 DEK，DLSF secretstream 对每帧认证，明文 ZIP 受总字节预算约束；随后严格验证 ZIP、唯一根 `will.md`、UTF-8、摘要和安全 Markdown 渲染。公开 ZIP 使用 `legacy/<摘要前两位>/<SHA-256>.zip` 内容寻址键。

数据库最终事务同时写入发布记录、5 项公开审计链、`RELEASED` 状态、发布会话密钥销毁、私有审计和联系人通知 outbox。事务失败时公开对象没有数据库可达记录；重试复用相同内容摘要。事务已提交但 worker 在确认前崩溃时，重启返回 `ALREADY_PUBLISHED`。

故障矩阵覆盖以下 18 个边界：暂存 VK 解包前/后、DEK 解包前/后、每个 secretstream chunk 前/后、ZIP 校验前/后、遗嘱渲染前/后、公开提升前/后、数据库事务前、公开审计追加前/后、通知 outbox 前/后及数据库事务后。每个注入点均验证明文暂存被清理，并验证“完全不可见”或“完整提交”二态及安全重试。

额外负向路径覆盖：密文篡改、secretstream 截断、错误 DEK、坏 ZIP、缺少 `will.md`、内容寻址对象冲突、对象存储不可用、数据库不可用、重复任务和 worker 重启。

`tests/integration/publication.test.ts` 使用真实 PostgreSQL、真实 DLSF 加密/解密、严格 ZIP inspector 和文件存储验证：

- 公开对象摘要/长度与 `app.publications` 一致，公开审计最终哈希与发布记录一致；
- 只从已提交记录解析对象键，未提交对象不可见；
- 单一 byte Range 返回正确内容，API 固定附件、`nosniff`、immutable cache、ETag 和并发/带宽限制；
- `app.publications` 与 `audit.public_events` 的更新/删除由权限和不可变触发器共同拒绝；没有撤回路由。

## 关键文件 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `packages/application/src/publication/finalize-publication.ts` | `5cda41d43fbde67e73e35fd175980a9a89bc7db4c098ddd5c848f55b29d9ca43` |
| `tests/faults/publication-crash-matrix.test.ts` | `bdcb63eb0e7728a7c185ff691b4678ed7308ef183f039bd5f9bff05776566380` |
| `tests/integration/publication.test.ts` | `884144fb9a3a80aab944acae9d6e0e3177f320f2c9dbc779e1d7228f01133920` |
| `packages/contracts/openapi/openapi.json` | `f854130ac4db0824ba67b2d0e8db44cec93b02a269e8261ec1d6fa8b71b5e286` |
| `packages/persistence/migrations/013_immutable_publication_surface.up.sql` | `1ebe81aac82ade12c13fe19b8a410a22ad23e33cf741ed1250c40f9eb2019e44` |
| `docs/operations/stage-key-capabilities.md` | `9fd8bc2bb9ae74cb002d85336de83d8ff489dda17b731d9952e839f646f9667a` |

## 交付收尾验证

北京时间 2026-08-09 11:56，执行：

```powershell
./ops/scripts/compose-smoke.ps1 -DeleteVolumes
```

结果通过。验证从空数据卷创建最小权限 PostgreSQL 角色、按序应用 1–13 号迁移、为 API/worker 挂载用途分离密钥、启动全部默认服务，并在 API/worker 重启后确认数据库及 private/staging/public 三类对象卷数据保持不变；随后删除该冒烟项目的容器、网络和数据卷。

本次真实启动验证额外发现并修复两项仅在全新 Windows + Linux 容器边界出现的问题：PostgreSQL 初始化脚本的 CRLF shebang 失效，以及 `libsodium` 冷进程中运行时长度常量尚未就绪导致合法 X25519 密钥被拒绝。对应回归门禁位于 `tests/deployment/compose-config.test.ts` 与 `packages/crypto/src/workflows/fragment-ingress.test.ts`。

北京时间 2026-08-09 12:03 的仓库级最终门禁结果：

- `pnpm.cmd acceptance`：通过；静态检查 359 个文件，单元测试 427 通过/1 跳过，集成测试 48/48，密码学测试 39/39，存储测试 17 通过/1 个可选 S3 测试跳过，部署测试 9/9，构建与 OpenAPI/客户端漂移检查通过；
- `pnpm.cmd exec vitest run tests/concurrency`：7 个文件，10/10 通过；
- `pnpm.cmd exec vitest run tests/faults`：1 个文件，20/20 通过。

计划 6 的浏览器 E2E 与计划 7 的对抗性安全测试目录尚未实施；根脚本已严格限定各自目录，并只在目录为空时显式允许零测试，避免 Playwright 误扫描 Vitest 文件。该行为不计入计划 5 的测试通过数量。

## 环境说明与剩余生产门禁

- 本次本机执行使用 Node `v24.14.0` 和 pnpm `11.16.0`（子命令中的 Corepack pnpm 为 `11.20.0`）；仓库锁定 Node `24.18.0`，因此命令输出包含 engine 警告，但上述门禁均以退出码 0 完成。正式发布前仍应在锁定的 Node `24.18.0` 镜像中复跑总验收。
- VSS wrapper 与密钥协议的独立密码学审查仍是生产发布阻断项；自动化测试不能替代外部审查。
- 当前 V1 每个用途只在线装载一个入口/暂存密钥版本。生产轮换必须遵守运行手册中的排空窗口，不能在旧版本活动数据存在时直接替换。
