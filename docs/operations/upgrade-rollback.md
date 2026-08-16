# 升级与回滚

升级前必须有最近一次经过空目标恢复验证的备份，并记录当前 Git/image/schema/protocol/key 版本、剩余磁盘和回滚目标。发布命令见 `linux-deployment.md`；只有深度健康、审计和运行时对账都通过后才更新当前版本标记。

应用回滚需要由发布流程生成并审核的 compatibility manifest。manifest 的 `version` 必须等于目标版本，`compatibleSchemaVersions` 必须显式包含当前数据库 schema，`imageDigests` 必须给出 api/worker/web/caddy 的完整 SHA-256。

    TARGET_VERSION=<ci-commit-sha-for-rollback>
    bash ops/scripts/rollback.sh \
      --version "$TARGET_VERSION" \
      --deployment-dir "/srv/dls/releases/$TARGET_VERSION" \
      --compatibility-manifest "/srv/dls/releases/$TARGET_VERSION/compatibility.json" \
      --env-file "/srv/dls/releases/$TARGET_VERSION/.env.production"

Windows/PowerShell 使用等价参数 `-Version`、`-DeploymentDirectory`、`-CompatibilityManifest`、`-EnvFile` 调用 `ops/scripts/rollback.ps1`。

回滚脚本读取当前 schema，只切换到清单中精确摘要的旧应用镜像，绝不执行 migration down。若 schema 不兼容、旧镜像健康失败或运行时数据不一致，立即保持维护模式，并按 `backup-restore.md` 恢复数据库和对象。不要修改 compatibility manifest 来绕过不兼容判断。

发布阶段失败或 stage key 状态不明时，不得简单重跑发布；先核对 lock、截止时间、stage-key 版本、审计链和 public 对象引用，再决定继续、应用回滚或完整恢复。
