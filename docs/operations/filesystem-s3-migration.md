# filesystem ↔ S3 迁移

迁移必须在维护窗口执行。先停止 API/worker 写入，在对象根创建维护标记，并保留最近一次已验证备份。整个过程逐对象核验字节数与 SHA-256；journal 允许同一命令在中断后安全续跑。S3 凭据通过受控环境或 secret 注入，不写入命令历史、manifest 或 journal。

## filesystem → S3

下例假定 `/srv/dls/migration/MAINTENANCE` 已存在，当前环境文件中只有一行 `STORAGE_DRIVER=filesystem`，S3 endpoint、region、三个 bucket 和凭据已通过环境提供。

    node node_modules/tsx/dist/cli.mjs ops/scripts/migrate-storage.ts \
      --maintenance-marker /srv/dls/migration/MAINTENANCE \
      --source-driver filesystem \
      --target-driver s3 \
      --source-private /srv/dls/objects/private \
      --source-staging /srv/dls/objects/staging \
      --source-public /srv/dls/objects/public \
      --manifest /srv/dls/migration/filesystem-inventory.json \
      --journal /srv/dls/migration/filesystem-to-s3.journal \
      --switch-env-file /srv/dls/releases/current/.env.production

复制完成后，迁移命令会再次读取目标对象并验证 inventory，只有全部一致才原子切换环境文件。切换后仍需显式验证 S3：

    node node_modules/tsx/dist/cli.mjs ops/scripts/verify-storage.ts \
      --manifest /srv/dls/migration/filesystem-inventory.json \
      --target-driver s3

随后启动只读检查，验证私有读取、staging、公开下载、Range、数据库引用和审计链，再恢复写入。源文件系统必须保留到另一次有审批的清理窗口。

## S3 → filesystem

反向迁移必须使用从 filesystem→S3 阶段保留下来的已验证 manifest，不能通过列举 bucket 猜测有效引用：

    node node_modules/tsx/dist/cli.mjs ops/scripts/migrate-storage.ts \
      --maintenance-marker /srv/dls/migration/MAINTENANCE \
      --source-driver s3 \
      --target-driver filesystem \
      --manifest /srv/dls/migration/filesystem-inventory.json \
      --journal /srv/dls/migration/s3-to-filesystem.journal \
      --target-private /srv/dls/objects/private \
      --target-staging /srv/dls/objects/staging \
      --target-public /srv/dls/objects/public \
      --switch-env-file /srv/dls/releases/current/.env.production

任何缺失对象、大小或摘要冲突、并发修改 `STORAGE_DRIVER`、不可读维护标记都会使迁移失败并保持原驱动配置。不要自动删除源端对象。
