# 备份与恢复

这是操作员驱动的一致性备份，不代表系统自动完成异地备份。开始前进入维护窗口，确认目标目录不是文件系统根且为空，并确保备份介质具备平台级加密和访问审计。

## 创建备份

脚本识别当前正在运行的 Caddy/web/API/worker，只暂停这些服务，导出数据库 inventory 和 PostgreSQL custom dump，打包对象树，最后只恢复原先运行的服务。文件系统模式会在对象根写入 `MAINTENANCE`；S3 模式会在服务静止后，严格按数据库 inventory 通过存储端口读取 private/staging/public 三个 bucket，将引用对象物化到一次性临时目录。

文件系统备份：

    pwsh -File ops/scripts/backup.ps1 -ProjectName dls-prod -Destination C:\dls-backups\2026-08-11 -ObjectRoot C:\dls\data\objects

Linux 使用：

    bash ops/scripts/backup.sh \
      --project dls-prod \
      --destination /srv/dls/backups/2026-08-11 \
      --object-root /srv/dls/data/objects

S3 备份从显式生产环境文件读取 endpoint、region、三个 bucket 及凭据文件路径。归档不包含 S3 凭据，临时对象树会在归档和校验完成后删除：

    pwsh -File ops/scripts/backup.ps1 `
      -ProjectName dls-prod `
      -Destination C:\dls-backups\2026-08-11-s3 `
      -StorageDriver s3 `
      -EnvFile C:\dls\.env.production

    bash ops/scripts/backup.sh \
      --project dls-prod \
      --destination /srv/dls/backups/2026-08-11-s3 \
      --storage-driver s3 \
      --env-file /srv/dls/.env.production

备份目录包含 `database.dump`、`database-state.json`、`objects.tar`、`runtime.json` 和 `manifest.json`。manifest 记录每个 artifact 和对象的字节数/SHA-256；runtime 记录 Git commit、数据库迁移、协议、存储驱动、密钥与镜像版本。凭据和明文用户内容不得额外写入这些元数据。

## 恢复到空目标

先启动一个明确命名、仅用于恢复的空 PostgreSQL 项目。不要预先运行应用迁移；restore 会拒绝已存在应用/audit/infra schema 或非空对象根，除非操作员另行给出破坏性批准。

    pwsh -File ops/scripts/restore.ps1 -Backup C:\dls-backups\2026-08-11 -ProjectName dls-restore -ObjectRoot C:\dls-restore\objects -EnvFile C:\dls\.env.production

    pwsh -File ops/scripts/verify-restore.ps1 -Backup C:\dls-backups\2026-08-11 -ProjectName dls-restore -ObjectRoot C:\dls-restore\objects -EnvFile C:\dls\.env.production

Linux 对应入口是：

    bash ops/scripts/restore.sh --backup /srv/dls/backups/2026-08-11 --project dls-restore --object-root /srv/dls-restore/objects --env-file /srv/dls/.env.production

    bash ops/scripts/verify-restore.sh --backup /srv/dls/backups/2026-08-11 --project dls-restore --object-root /srv/dls-restore/objects --env-file /srv/dls/.env.production

恢复脚本会先验证备份、解析 TAR 头并拒绝符号链接、硬链接、特殊条目、重复或越界路径，再检查对象目标，随后停止应用写入者并检查数据库是否为空。只有这些检查全部完成，且非空目标已获得单独的破坏性批准时，才会清空对象目标并开始恢复；检查失败不会提前删除对象。

当前恢复入口总是先恢复到空白文件系统对象根。S3 来源的备份也使用相同的可移植 `objects.tar`，但若目标运行时需要 S3，必须先完成并验证空白文件系统恢复，再按[文件系统与 S3 迁移](./filesystem-s3-migration.md)执行经维护窗口保护的迁移；不要把这描述为“直接 S3 恢复”。

验证会重新计算 artifact/对象摘要，精确比较 schema、表计数、package/publication 引用、私有/公开审计终点和 outbox 状态。随后应使用应用镜像运行 `ops/scripts/runtime-reconcile.mjs`，确认数据库引用的 private/staging/public 对象存在、没有超过容忍年龄的未投递 outbox，也没有 failed/cancelled job。

任何差异都会保留 `MAINTENANCE`。只有人工确认公开下载、Range、审计、队列和 stage-key 恢复演练后才能移除维护标记。破坏性恢复不可替代保留原备份和原对象树。
