# Production readiness

自动化 acceptance 证明的是“local V1 automated gates 通过”，不是生产就绪。上线前必须由独立人员签字确认：

1. 独立密码学审查覆盖 KDF、VSS、X25519、secretstream、恢复/发布 stage key 和密钥销毁边界。
2. 法律/遗嘱内容、联系人同意、拒绝披露、通知和数据保留策略得到适用司法辖区的批准。
3. 独立人工渗透测试覆盖浏览器、HTTP、SMTP/URL SSRF、归档解析、范围下载、任务/数据库边界和权限隔离。
4. 操作员在空白资源完成过备份恢复、审计链验证、公开下载/range 校验和失败回滚演练。
5. 监控、告警、值班、磁盘/证书/邮件/备份责任人明确，恢复目标和维护窗口已记录。
6. `dls-backup.timer` 已连续成功生成 secret bundle，`dls-restore-drill.timer` 已完成一次真实解密恢复；离线 key 与 bundle 位于不同故障域。
7. 使用 `ops/scripts/smtp-acceptance.mjs send` 向真实 primary 和 backup 邮箱投递，并用两封邮件中的 receipt code 完成 `confirm`；单收件人证据不再被接受。

Acceptance 必须把缺少上述批准记为外部 blocker，不能用单元测试、simulation、绿色 CI 或本地 Docker smoke 自行解除。生产环境禁止 `DLS_TEST_MODE=true`、Mailpit、真实凭据模板和可用 stage key。

上线决定还应记录负责人、批准时间、回滚版本、最近一次恢复演练的证据路径，以及任何尚未解决的限制条件；这些记录与本文件一起保存，不写入运行时 secret 或用户内容。
