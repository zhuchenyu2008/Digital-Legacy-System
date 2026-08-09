import Link from "next/link";

export function ArmingChecklist({ activeContacts, activePackageVersion, requiredContacts }: Readonly<{ activeContacts: number; activePackageVersion: number | null; requiredContacts: number }>) {
  const contactsReady = activeContacts >= requiredContacts;
  const packageReady = activePackageVersion !== null;
  return <section className="dls-panel"><h2>启用检查</h2><ul className="dls-checklist"><li data-complete={contactsReady}><span>{contactsReady ? "✓" : "○"}</span><div><strong>紧急联系人</strong><p>{contactsReady ? `已有 ${activeContacts} 位有效联系人` : `还需要 ${Math.max(0, requiredContacts - activeContacts)} 位有效联系人`}</p></div><Link href="/admin/contacts">管理联系人</Link></li><li data-complete={packageReady}><span>{packageReady ? "✓" : "○"}</span><div><strong>加密文件包</strong><p>{packageReady ? `当前活动版本 V${activePackageVersion}` : "尚未激活加密文件包"}</p></div><Link href="/admin/files">管理文件</Link></li></ul>{contactsReady && packageReady ? <p className="dls-safe-copy">必要材料已经就绪。请完成签到并确认当前分片代次有效。</p> : <p>完成所有项目后，系统才能进入已启用状态。</p>}</section>;
}
