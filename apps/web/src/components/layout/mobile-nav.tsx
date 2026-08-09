"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../icons/icon";

const items = [
  { href: "/admin", label: "首页", icon: "home" },
  { href: "/admin/contacts", label: "联系人", icon: "contacts" },
  { href: "/admin/files", label: "文件", icon: "file" },
  { href: "/admin/settings", label: "设置", icon: "settings" },
] as const;

export function MobileNav({ active }: Readonly<{ active?: string | undefined }>) {
  const pathname = usePathname();
  const current = active ?? pathname;
  return (
    <nav aria-label="移动端主导航" className="dls-mobile-nav">
      {items.map((item) => (
        <Link
          aria-current={current === item.href ? "page" : undefined}
          href={item.href}
          key={item.href}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
