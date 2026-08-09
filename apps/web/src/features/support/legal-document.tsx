export type LegalDocumentKind = "legal" | "privacy";

export function LegalDocument({
  kind,
  operatorContact,
  version,
  versionDate,
}: Readonly<{
  kind: LegalDocumentKind;
  operatorContact: string;
  version: string;
  versionDate: string;
}>) {
  const legal = kind === "legal";
  return (
    <article className="dls-legal-document">
      <header>
        <p className="dls-eyebrow">{legal ? "使用条款" : "隐私说明"}</p>
        <h1>{legal ? "本地数字遗产系统使用说明" : "隐私与数据处理说明"}</h1>
        <p>
          版本 {version} · 生效日期 {versionDate}
        </p>
      </header>
      {legal ? (
        <>
          <section>
            <h2>适用范围</h2>
            <p>
              本系统用于单一所有者在其控制的本地部署中管理加密数字遗产、联系人确认流程和发布材料。部署管理员负责确认所在地规则、使用目的与人员授权。
            </p>
          </section>
          <section>
            <h2>重要限制</h2>
            <p>
              本说明不构成法律意见，也不表示材料已由律师审核。涉及遗嘱效力、继承、隐私或跨境事项时，应咨询具备相应资格的专业人士。
            </p>
          </section>
          <section>
            <h2>操作者责任</h2>
            <p>
              操作者应维护部署、备份、密钥、邮件配置和联系人信息的准确性，并在正式启用前完成恢复演练和发布内容复核。
            </p>
          </section>
        </>
      ) : (
        <>
          <section>
            <h2>数据最小化</h2>
            <p>
              系统仅处理完成身份验证、加密存储、通知、工作流和审计所需的数据。页面不会显示审计中的
              IP、客户端信息、凭据、密钥或分片明文。
            </p>
          </section>
          <section>
            <h2>本地控制</h2>
            <p>
              数据由本地部署的操作者控制。密码、密钥和份额明文仅在短时浏览器内存或受控工作进程中使用，不写入浏览器持久化存储。
            </p>
          </section>
          <section>
            <h2>保留与请求</h2>
            <p>
              不可变审计和已发布材料的保留由系统安全与完整性要求决定。其他访问、更正或删除请求请联系部署操作者。
            </p>
          </section>
        </>
      )}
      <footer>
        <h2>联系操作者</h2>
        <p>{operatorContact}</p>
      </footer>
    </article>
  );
}
