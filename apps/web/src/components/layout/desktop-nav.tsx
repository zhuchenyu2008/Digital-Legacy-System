import Link from "next/link";
import { Wordmark } from "../brand/wordmark.js";
import { Icon } from "../icons/icon.js";
import { StatusBadge } from "../ui/status-badge.js";

const ownerItems = [
  { href: "/admin", label: "首页" },
  { href: "/admin/contacts", label: "联系人" },
  { href: "/admin/files", label: "文件" },
  { href: "/admin/settings", label: "设置" },
] as const;

export function DesktopNav({ active, status = "ARMED" }: Readonly<{ active?: string | undefined; status?: string | undefined }>) {
  return (
    <header className="dls-desktop-header">
      <div className="dls-header-inner">
        <Wordmark href="/admin" />
        <nav aria-label="管理员主导航">
          {ownerItems.map((item) => <Link aria-current={active === item.href ? "page" : undefined} href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="dls-header-actions"><StatusBadge tone={status.includes("ARMED") ? "safe" : "warning"}>{status}</StatusBadge><Link aria-label="账户" href="/admin/settings"><Icon name="user" /></Link></div>
      </div>
    </header>
  );
}
