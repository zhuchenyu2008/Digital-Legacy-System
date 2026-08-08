# 计划 4：身份、签到、联系人与共享代次验收

证据时间：2026-08-08，北京时间（Asia/Shanghai）。

## 门禁结果

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 全量静态检查 | 通过 | `pnpm.cmd check`；265 个文件无问题 |
| 全量 unit | 通过 | 33 个测试文件；351 通过、1 跳过 |
| 全量 integration | 通过 | 12 个测试文件；32/32 通过 |
| 全量 crypto/VSS | 通过 | 3 个测试文件；33/33 通过 |
| 全量构建 | 通过 | domain、contracts、vss-wasm、crypto、application、persistence、storage、web、api、worker 均完成构建 |
| OpenAPI | 通过 | 生成后 `openapi:check` 通过；漂移测试通过 |
| 共享代次并发激活 | 通过 | `tests/concurrency/share-activation-race.test.ts`；1/1 通过 |

## 行为证据

- owner 单例 setup、owner 登录/签到/设置和密码轮换已完成并通过对应应用层与 integration 测试。
- 联系人邀请只持久化 token digest；邀请响应不包含原始 token；同意版本、联系人注册和登录已覆盖。
- 联系人密码轮换保持 CPK 不变，接受新的 CSK 包裹，撤销旧 CONTACT sessions；密码修改入口不会返回私钥明文。
- 联系人移除要求 owner 重新认证；少于 3 位有效联系人时拒绝；移除后状态进入 `CONFIGURING` 并要求新的共享代次，历史同意/审计证据保留。
- 共享代次由服务端重新计算联系人快照和门限：死亡 `ceil(N × 0.70)`，恢复 `floor(N / 2) + 1`；上传校验快照、VK commitment、proof 绑定、唯一连续索引、密文尺寸和幂等重试。
- 共享代次激活在同一事务内更新 generation、vault 指针、联系人状态、`contact_set_version`、owner 状态以及 audit/outbox；旧 generation 被退休。
- HTTP 入口使用 owner session、Origin、CSRF 保护；contact crypto-material 只返回公钥和加密包裹材料。

## 已知限制与环境说明

- 当前工作区运行时为 Node `v24.14.0`，仓库 engines 声明为 `v24.18.0`；本次所有门禁均通过，但应在发布前使用锁定的 Node `24.18.0` 容器复跑。
- VSS wrapper 的独立密码学审查仍是生产发布门槛；自动化测试覆盖协议向量、上下文隔离、错误输入和并发边界，但不替代外部审查。
