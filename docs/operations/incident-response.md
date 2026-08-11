# Incident response

本 runbook 先保护证据，再限制影响；不要在公开日志、邮件或工单中粘贴密码、token、私钥、分片或原始遗嘱。

## 疑似密码/密钥泄露

立即暂停登录、恢复和发布入口，保留 API/worker/Caddy/数据库审计日志，轮换受影响的 session secret、token pepper、ingress key 和 stage key。撤销所有活动会话，确认恢复/发布 workflow 没有处于可解密阶段，再通过受控流程重新生成分片。不要删除审计记录；用审计链验证器记录处置事件。

## 数据库/存储事件

把数据库和对象存储切入维护模式，禁止新上传和公开下载。记录当前迁移版本、对象 inventory、公开引用、任务队列和磁盘状态；对备份执行空目标恢复和 SHA-256 对账。若发现缺失或冲突对象，保留源文件系统和原始备份，不进行自动清理。

## 邮件/发布故障

暂停外部 SMTP，确认 SMTP 目标没有被 SSRF 或转发头污染。发布阶段失败时保留 stage key 和 audit evidence，在确认 lock、截止时间、公开对象 digest 一致后再重试。意外公开时先撤销 Caddy/public 对象访问，再保护审计和访问日志，通知法律/隐私负责人。

如果 stage key 丢失、版本不明或无法解封，立即冻结对应发布/恢复 workflow，不生成替代 key 覆盖现状。保存 release stage、fragment、key-version、worker 重试和审计证据；由独立恢复审批决定使用已验证备份恢复或终止流程。没有证明现有密文可被正确解封前，不得 finalize 发布。

## 磁盘耗尽或任务堆积

限制上传、停止 worker 在安全点，保存 dead-letter/job payload 的脱敏摘要，检查 staging、临时文件和备份空间。清理必须经过明确的对象引用对账，不得根据文件名猜测可删除内容。
