# Development secret generation

Local Docker secret files belong in `ops/secrets/generated/`. That directory is ignored by Git. Generate the complete set on Windows, Linux, or macOS with:

```sh
node ops/scripts/generate-development-secrets.mjs
```

Set `DLS_SECRETS_DIR` to write to a different directory. The generator creates only missing files, uses restrictive permissions where the operating system supports them, and refuses to complete a half-present X25519 pair. It never overwrites existing values or prints secret material.

The generated set contains:

- six independently generated PostgreSQL role passwords;
- `session-secret`, `token-pepper`, and the independent versioned `field-keyring`;
- release X25519 ingress public/private keys and `release-stage-kek`;
- recovery X25519 ingress public/private keys and `recovery-stage-kek`;
- optional S3 development credentials.

Compose mounts capabilities by ownership: API receives the release public key plus recovery public/private/stage keys; worker receives only the release public/private/stage keys. Do not put all key variables in a shared `.env`, because both processes fail closed when forbidden capabilities are present. Version numbers are configured separately through `DLS_RELEASE_INGRESS_KEY_VERSION`, `DLS_RECOVERY_INGRESS_KEY_VERSION`, `DLS_RELEASE_STAGE_KEY_VERSION`, and `DLS_RECOVERY_STAGE_KEY_VERSION` (default `1`).

For direct host development, export only the variables listed for that process in [stage-key-capabilities.md](../../docs/operations/stage-key-capabilities.md). Docker Compose reads the files directly. Never commit generated values, paste them into logs, or reuse development secrets in production.

Production deployments must use independently generated, access-controlled secret mounts and the documented rotation procedure rather than development files or `.env` values. The `field-keyring` file is a versioned JSON keyring (`activeVersion`, historical `keys`, and an independent `lookupKey`); rotation appends a new encryption key while retaining old versions until all rows are rewrapped.

只轮换长期字段密钥时使用 `node ops/scripts/generate-development-secrets.mjs --rotate-field-keyring`；它不会替换 `session-secret`，因此旧字段可以在 rewrap 完成前继续通过兼容路径读取。`--rotate` 仍表示开发环境全量轮换，不得在生产字段尚未 rewrap 时使用。

## 生产密钥离线/异地备份

数据库与 object backup 不包含 `/run/secrets` 中的生产密钥。为避免“数据库和对象都在、但无法解密”的单点故障，使用独立的 32 字节备份密钥对 secret 文件目录做加密封装，并把备份密钥和封装文件放到不同的离线/异地保管位置（例如两个不同的硬件密钥库或 KMS 管理域）。

生成备份密钥（只在离线密钥库中保存，不要和 bundle 放在同一台机器）：

```sh
openssl rand -base64 32 > /offline/dls-secrets-backup.key
```

执行备份（`--production` 会校验完整生产 secret 集合）：

```sh
node ops/scripts/secrets-backup.mjs backup \
  --source /srv/dls/secrets \
  --output /offline/dls-secrets-2026-08-15.bundle.enc \
  --key-file /offline/dls-secrets-backup.key
```

生产制度中，`dls-backup.timer` 每次普通数据库/object backup 都会在独立的 `DLS_SECRETS_BACKUP_ROOT` failure domain 写入并立即 `verify` 一个同名 bundle；bundle 同时封装完整生产 secrets 和 `.env.production` 配置。`dls-restore-drill.timer` 会用离线 key 恢复到一次性 `DLS_SECRETS_DIR`，只使用恢复出的配置和 `data-backup-key` 实际解密普通 backup 后再清理。`DLS_SECRETS_BACKUP_KEY_FILE` 必须位于生产 secrets 和 backup media 之外，不能随机器或普通 backup 一起保存。

恢复前先完成双人复核，目标目录必须是空目录；恢复后再用数据库/object backup 的校验与 `verify-restore` 检查启动。

```sh
node ops/scripts/secrets-backup.mjs restore \
  --bundle /offline/dls-secrets-2026-08-15.bundle.enc \
  --target /srv/dls/rebuilt-secrets \
  --key-file /offline/dls-secrets-backup.key
```

bundle 只输出文件数量、哈希和 key fingerprint，不输出任何 secret 内容。每次生产备份都应记录 bundle 的 SHA-256、保管位置、审批人和恢复演练日期；至少每季度做一次“机器全丢”演练。
