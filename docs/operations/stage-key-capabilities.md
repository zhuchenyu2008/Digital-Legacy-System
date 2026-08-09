# 入口密钥与暂存密钥运行手册

本文定义死亡发布与密码恢复流程所需密钥的进程边界、版本管理、轮换和灾难恢复。文档只列变量名与操作原则，不包含任何密钥、口令或可用于还原密钥的值。所有时间与值班记录使用北京时间（`Asia/Shanghai`, UTC+08:00）。

## 能力矩阵

| 能力/变量 | 所属进程 | 明确禁止挂载的进程 | 版本变量 | 持久化版本字段 | 丢失后果 |
| --- | --- | --- | --- | --- | --- |
| `RELEASE_INGRESS_PUBLIC_KEY` | API、worker | 无；它是公钥，但不得由其他用途复用 | `RELEASE_INGRESS_KEY_VERSION` | `app.workflow_key_fragments.ingress_key_version` | 不能为新的死亡确认片段构造正确入口包；可从同版本私钥重新导出公钥 |
| `RELEASE_INGRESS_PRIVATE_KEY` | worker | API | `RELEASE_INGRESS_KEY_VERSION` | `app.workflow_key_fragments.ingress_key_version` | worker 无法打开该版本的待处理死亡确认片段，死亡发布不能达到阈值 |
| `RELEASE_STAGE_KEK` | worker | API | `RELEASE_STAGE_KEY_VERSION` | `app.workflow_key_fragments.stage_key_version`、`app.release_secret_sessions.stage_key_version` | 无法打开已验证片段或活动发布会话中的 VK，发布被阻断 |
| `RECOVERY_INGRESS_PUBLIC_KEY` | API | worker | `RECOVERY_INGRESS_KEY_VERSION` | `app.workflow_key_fragments.ingress_key_version` | 不能接收新的密码恢复片段；可从同版本私钥重新导出公钥 |
| `RECOVERY_INGRESS_PRIVATE_KEY` | API | worker | `RECOVERY_INGRESS_KEY_VERSION` | `app.workflow_key_fragments.ingress_key_version` | API 无法打开该版本的待处理恢复片段，密码恢复不能达到阈值 |
| `RECOVERY_STAGE_KEK` | API | worker | `RECOVERY_STAGE_KEY_VERSION` | `app.workflow_key_fragments.stage_key_version`、`app.recovery_secret_sessions.stage_key_version` | 无法继续活动恢复/重包会话，所有者密码恢复被阻断 |

API 启动时只接受“死亡入口公钥 + 恢复入口密钥对 + 恢复暂存 KEK”；worker 启动时只接受“死亡入口密钥对 + 死亡暂存 KEK”。任何禁止变量即使值有效也会使进程启动失败。两个流程不得共用密钥或版本号含义。

## 生成与保管

入口密钥使用仓库固定的 X25519 实现生成，暂存 KEK 使用密码学安全随机源生成 32 字节。先在隔离的密钥管理环境构建并验证仓库，再执行等价于以下逻辑的生成程序；输出必须直接写入密钥管理系统，不得写入 shell 历史、CI 日志、工单或仓库文件。

```text
release ingress = generateContactKeyPair()
recovery ingress = generateContactKeyPair()
release stage KEK = CSPRNG(32 bytes)
recovery stage KEK = CSPRNG(32 bytes)
encoding = canonical Base64
```

每个私钥/KEK 至少保存一份加密离线备份，备份标签必须包含用途、版本、创建北京时间、启用北京时间和校验摘要。公钥与对应私钥必须在隔离环境调用 `assertX25519KeyPair` 验证。暂存 KEK 解码后必须恰好为 32 字节。密钥材料不得进入应用数据库、对象存储、容器镜像层或可观测性系统。

## 启动与健康信号

1. 先向目标进程只挂载能力矩阵允许的变量。
2. 启动前确认所有版本变量为正整数，公私钥版本一致，Base64 为规范编码。
3. 运行 `pnpm.cmd exec vitest run tests/integration/key-capabilities.test.ts`；该门禁验证允许能力、禁止交叉挂载、缺失/畸形密钥、版本错误和公私钥不匹配。
4. 启动 API/worker。密钥加载失败必须视为 `CRITICAL`，进程不得进入 ready；禁止用空值、临时随机值或旧用途密钥继续启动。
5. 启动后检查 ready/heartbeat、`DLS-FRAGMENT-KEY-VERSION`、`DLS-RELEASE-STAGE-KEY`、包 DEK/VK 解包失败和连续任务重试。任一版本不可用都应停止相关工作流推进并告警。

## 轮换窗口

当前 V1 provider 每个用途只装载一个活动版本，不提供在线历史密钥环。因此轮换必须采用“排空后切换”，不能在仍有旧版本数据时直接替换。

### 入口密钥轮换

1. 冻结对应用途的新工作流/片段提交。
2. 查询 `app.workflow_key_fragments`，确认旧 `ingress_key_version` 不再存在 `PENDING` 片段；已接受的片段必须已转为正确的暂存版本或已销毁。
3. 生成新密钥对并将版本严格增加 1；先验证公私钥匹配。
4. 在同一维护窗口更新该用途允许的进程挂载：死亡用途更新 API 公钥以及 worker 公钥/私钥；恢复用途只更新 API 公钥/私钥。
5. 重启并通过能力启动测试、ready 和一条受控的片段往返探针后再恢复提交。
6. 旧私钥保持离线封存，直到旧版本片段和相关审计保留期结束；不要继续在线挂载。

### 暂存 KEK 轮换

1. 冻结对应用途的新片段暂存和会话创建。
2. 死亡用途确认旧版本 `workflow_key_fragments` 已销毁或关闭，且 `app.release_secret_sessions` 没有旧版本 `ACTIVE` 行；恢复用途对 `app.recovery_secret_sessions` 做同样检查。
3. 生成新的独立 32 字节 KEK，将版本严格增加 1，并记录双人复核的北京时间。
4. 只更新所属进程的 KEK 与版本，重启后运行能力门禁、ready 和受控流程探针。
5. 确认新建行只记录新版本后恢复流量。旧 KEK 离线封存到相关会话保留期结束。

建议轮换安排在有数据库、对象存储和 worker 值班人员同时在线的维护窗口。若无法排空，不得轮换；应先延长维护窗口或恢复旧版本服务。

## 丢失、误挂载与恢复

- 私钥或 KEK 疑似泄露：立即冻结对应用途，保存审计证据，撤销进程挂载，评估仍受该版本保护的片段/会话；在排空或明确终止这些状态后按新版本轮换。泄露事件不得通过简单重启结案。
- 私钥或 KEK 意外丢失但无泄露迹象：从加密离线备份恢复完全相同的用途和版本，验证摘要与密钥对后重启。禁止生成新值并沿用旧版本号。
- 旧版本无备份：相关密文不可恢复。死亡发布必须保持未发布并升级人工事件响应；恢复流程应终止旧会话、销毁不可用暂存材料，并在所有者仍可认证时重新建立共享代次。不得伪造成功或绕过阈值。
- 禁止能力被挂载：进程会 fail closed。移除禁止变量，确认部署模板未把共享 secret 集合整体挂载，再重新运行能力门禁。
- 版本不匹配：保持任务可重试但不推进状态；恢复正确的同版本密钥。只有完成排空流程后才能提高版本。

## 审计清单

每次生成、启用、轮换、恢复和销毁均记录：用途、旧/新版本、操作者、复核者、北京时间、变更单、离线备份状态、排空查询结果、能力测试结果、ready/heartbeat 结果和受控探针结果。记录可包含密钥摘要，但不得包含密钥、Base64 编码、私钥路径或 secret-manager 读取令牌。
