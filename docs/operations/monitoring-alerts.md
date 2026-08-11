# Monitoring and alerts

监控信号只包含计数、状态、耗时和 digest，不包含请求体、密码、token、分片、stage key、SMTP 内容或遗嘱正文。

## 必备信号

- API/web/Caddy 深度 health：live、ready、数据库连接和存储读写；连续失败触发维护通知。
- pg-boss：队列深度、重试数、dead-letter 数、最老任务年龄和 worker 心跳；发布/恢复队列必须单独告警。
- PostgreSQL：连接池耗尽、锁等待、迁移版本漂移、审计序列间隙和 WAL/磁盘增长。
- Storage：private/staging/public 使用率、临时上传年龄、对象 digest mismatch、缺失引用、range 读取错误。
- Security：认证限流、CSRF/Origin 拒绝、异常 Host/Forwarded、SMTP 目标变化、公开对象 404/403 比率。
- TLS/邮件/备份：证书到期、STARTTLS/SMTPS 探测失败、最近备份年龄、manifest 哈希不一致和最近一次空目标恢复结果。

## 值班动作

告警必须链接到 incident-response、当前版本、最近审计完整性结果和最近一次已验证备份。任何需要查看密钥或原文的动作都交给最小权限的人工流程，不在监控系统中回显。
