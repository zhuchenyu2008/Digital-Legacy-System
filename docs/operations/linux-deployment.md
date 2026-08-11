# Linux 生产部署

支持 x86_64 与 arm64 Linux 主机。前置条件包括 Docker Engine 与 Compose plugin、指向主机的 DNS、可入站访问的 80/443、外部 SMTPS/STARTTLS 邮箱、受限的 `/srv/dls` 数据目录，以及独立保存的已验证备份。生产默认使用主机文件系统对象根，不启动 Mailpit 或 MinIO。

## 目录与配置

- `/srv/dls/releases/<version>`：只读发布包，包含 Compose、脚本和生产依赖。
- `/srv/dls/data`：PostgreSQL、private/staging/public 对象。
- `/srv/dls/secrets`：权限 0700，文件权限 0600，只挂载给需要该 secret 的进程。
- `/srv/dls/backups/<timestamp>`：最近一次通过空目标恢复验证的备份。

    bash ops/scripts/init-secrets.sh --deployment-dir /srv/dls
    cp .env.production.example /srv/dls/releases/2026.08.11/.env.production

编辑 production env：设置域名、`DLS_DATA_DIR=/srv/dls/data`、`DLS_SECRETS_DIR=/srv/dls/secrets`、外部 SMTP/发件人、联系人同意文档版本与 SHA-256、不可变镜像 tag 与四个 digest。占位的全零 digest 和空同意文档摘要不可用于部署。预先创建 `objects/private`、`objects/staging`、`objects/public`，并确保容器 UID/GID `1000:1000` 可读写。

`init-secrets.sh` 会另行生成 `setup-token` 与 `session-pepper`。首次 owner 初始化时，只通过受限运维通道把 `/srv/dls/secrets/setup-token` 的值交给现场操作者；不要把它复制到 `.env.production`、工单、聊天或日志。初始化完成后按变更流程轮换 setup token，并保留 secret 文件权限 `0600`。

## 发布

    bash ops/scripts/deploy.sh \
      --version 2026.08.11 \
      --deployment-dir /srv/dls/releases/2026.08.11 \
      --backup-dir /srv/dls/backups/2026-08-11 \
      --env-file /srv/dls/releases/2026.08.11/.env.production

脚本依次验证磁盘与备份、解析 Compose、拉取不可变镜像、迁移、启动、深度健康、私有/公开审计及运行时存储/outbox/job 对账，最后才写 `.current-version`。Caddy 只发布 80/443；PostgreSQL、API、worker、web 仅在 internal 网络。

如使用外部 S3，先按 `filesystem-s3-migration.md` 在维护窗口迁移并验证三个 bucket，再把 `DLS_STORAGE_DRIVER` 切换为 `s3`。生产 Compose 本身不会启动 MinIO。

## 运维边界

监控 health、队列/dead-letter、磁盘、数据库、审计、存储、TLS、SMTP 与备份年龄。日志不得包含 token、密钥、分片或遗嘱正文。升级/回滚遵循 `upgrade-rollback.md`，数据库迁移不自动向下回滚。独立密码学、法律、人工渗透和恢复批准仍是生产 blocker，绿色本地 acceptance 不能替代。

发布前先运行宿主机完整门禁 `bash ops/scripts/acceptance.sh`。随后可运行 `docker compose --profile test up --build --abort-on-container-exit acceptance` 生成 `docs/acceptance/linux-container-evidence.json`；容器只验证已经由 Docker 构建阶段产出的只读应用和当前 Compose 栈，不挂载 Docker socket。Linux 证据中的协议版本及 Protocol、Vectors、Application SHA-256 必须与宿主机正式证据完全一致。容器 parity 不能代替 S3 合约、镜像扫描、空目标恢复和运行时对账，这些仍由宿主机完整门禁执行。
