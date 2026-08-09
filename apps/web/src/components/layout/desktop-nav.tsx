"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "../brand/wordmark";
import { Icon } from "../icons/icon";
import { StatusBadge } from "../ui/status-badge";

const ownerItems = [
  { href: "/admin", label: "首页" },
  { href: "/admin/contacts", label: "联系人" },
  { href: "/admin/files", label: "文件" },
  { href: "/admin/settings", label: "设置" },
] as const;

export function DesktopNav({
  active,
  status = "ARMED",
}: Readonly<{ active?: string | undefined; status?: string | undefined }>) {
  const pathname = usePathname();
  const current = active ?? pathname;
  const displayedStatus =
    pathname === "/admin/workflows/current" && status === "ARMED" ? "ARMED (PENDING)" : status;
  return (
    <header className="dls-desktop-header">
      <div className="dls-header-inner">
        <Wordmark href="/admin" />
        <nav aria-label="管理员主导航">
          {ownerItems.map((item) => (
            <Link
              aria-current={current === item.href ? "page" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="dls-header-actions">
          <StatusBadge tone={displayedStatus.includes("ARMED") ? "safe" : "warning"}>
            {displayedStatus}
          </StatusBadge>
          <Link aria-label="通知" className="dls-header-notifications" href="/admin/audit">
            <Icon name="notification" />
          </Link>
          <Link aria-label="账户" href="/admin/settings">
            <Icon name="user" />
          </Link>
        </div>
      </div>
    </header>
  );
}
