# Domain Persistence / 领域持久化验收证据

## 范围

- 计划：`docs/superpowers/plans/2026-08-05-02-domain-persistence.md`
- 工作树：`D:\code\Digital-Legacy-System\.worktrees\codex-complete-local-v1`
- 分支：`codex/complete-local-v1`
- 验收时间：2026-08-08 17:10（北京时间，`Asia/Shanghai`, UTC+08:00）

本记录覆盖 migration、事务持久化、审计链、任务调度和数据库并发不变量的当前本地验收证据。Task 3-7 的计划条目已在计划文档中标记完成。

## 固定环境

| 项目 | 实际值 |
| --- | --- |
| Node.js | `node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d` |
| pnpm | `11.20.0` |
| PostgreSQL | `18.4 (Debian 18.4-1.pgdg12+1)` |
| PostgreSQL 镜像 | `postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382` |
| 数据库连接 | 临时容器 `dls-persistence-test`，宿主端口 `55432` |

## 事务与并发决策

- 测试客户端使用 PostgreSQL 默认 `READ COMMITTED`，每个竞态参与者显式 `BEGIN` / `COMMIT`。
- workflow 和 vault 的决策入口先以 `SELECT ... FOR UPDATE` 锁定聚合行，再基于当前持久化 state/version 写入。
- `workflow_contact_actions` 的 `(workflow_id, contact_id)` 唯一约束保证同一 contact 的重复决定只产生一次动作。
- `uq_active_share_generation` 部分唯一索引和 vault 的 active-generation 指针共同保证最多一个 ACTIVE generation。
- 每个成功的状态/version 变化在同一事务中写入一个 outbox 事件；失败事务回滚，不留下半个状态变化。

## 并发案例

| 测试文件 | 同步客户端 | 验证结果 |
| --- | ---: | --- |
| `tests/concurrency/affirmation-race.test.ts` | 20 | approved counter 不超过阈值；恰好一次进入 `RELEASE_PENDING`；version 1、2、3 各有一个 outbox 事件；20 个 contact action 不重复 |
| `tests/concurrency/alive-cancel-race.test.ts` | 20 | 恰好一个 `ALIVE` action 和取消事件；approved counter 保持为 2；version 只增加一次 |
| `tests/concurrency/release-cancel-race.test.ts` | 20 | row-lock 首个赢家决定 `RELEASED` 或 `CANCELLED`；后续调用根据已持久化 state no-op；只产生一个终态事件 |
| `tests/concurrency/share-activation-race.test.ts` | 20 | 恰好一个 ACTIVE generation；vault 指针与其一致；只产生一个激活事件 |

## 命令与结果

以下命令均在固定 Node 容器中运行，退出码为 `0`：

| 北京时间 | 命令 | 结果 |
| --- | --- | --- |
| 2026-08-08 17:03 | `pnpm exec vitest run tests/concurrency --no-file-parallelism` | 4 个测试文件、4 个测试通过 |
| 2026-08-08 17:09 | 同一并发命令重复 20 次 | `REPEATED_RUNS=20`，20/20 通过 |
| 2026-08-08 17:09 | `pnpm --filter @dls/persistence migrate:down -- --steps 1` 后 `migrate:up` | migration 6 down、migration 7 up 成功，checksum 保持一致 |
| 2026-08-08 17:10 | `pnpm --filter @dls/application build`、`@dls/persistence build`、`@dls/worker build` | 三个包均 `tsc -b` 成功 |

验收后的只读数据库检查：`infra.schema_migrations` 最新版本为 `7`；`owner_envelope_algorithm='test'` 的 vault 数为 `0`；并发 fixture 的零字节 contact 数为 `0`。

## 边界

本记录证明数据库事务与 schema 约束下的并发不变量，以及计划 2 已实现组件的固定环境行为；它不替代后续计划 3-7 的密码学、HTTP、UI、邮件、E2E、部署和备份验收。
