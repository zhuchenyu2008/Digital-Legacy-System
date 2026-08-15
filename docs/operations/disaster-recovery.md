# 灾备与生产密钥恢复演练

本系统把三类恢复材料分开保管：

- PostgreSQL `database.dump` 与 `database-state.json`；
- filesystem/S3 object archive 与 `manifest.json`；
- 独立加密的 secrets bundle（由 `ops/scripts/secrets-backup.mjs` 生成）。

生产密钥 bundle 不放入数据库或 object backup，也不与解密 key 放在同一保管位置。恢复至少需要两名值班人员复核 bundle SHA-256、key fingerprint、备份 manifest 与 Git image digest。

## “机器全丢”演练

在隔离的 disposable Compose project 中执行：

```powershell
node ops/scripts/generate-development-secrets.mjs
PowerShell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/backup-restore-smoke.ps1
node ops/scripts/secrets-backup.mjs backup --source <secrets> --output <offline>/secrets.bundle.enc --key-file <offline>/backup.key
node ops/scripts/secrets-backup.mjs restore --bundle <offline>/secrets.bundle.enc --target <empty-target> --key-file <offline>/backup.key
```

演练必须验证：迁移版本、数据库 marker、package/public object 三个 namespace、audit/outbox/job reconciliation、secret 文件哈希和 API/Worker 启动后的 `/health/ready`。不要对生产 Compose project 使用 `--destructive-approval`。

## 2026-08-15（北京时间）记录

已完成独立 secrets bundle 的加密备份→空目录恢复和文件哈希校验。完整 DB/object “机器全丢”演练已尝试执行，但当前工作站 Docker Engine 未运行且 `//./pipe/docker_engine` 不可用，因此没有把失败环境冒充为通过；在具备 Docker Engine 的 CI/灾备主机上必须重新执行上述 disposable project 演练，并把生成的 acceptance evidence 与 bundle manifest 一并归档。
