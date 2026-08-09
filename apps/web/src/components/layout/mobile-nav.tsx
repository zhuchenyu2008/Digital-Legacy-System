import Link from "next/link";
import { Icon } from "../icons/icon";

const items = [
  { href: "/admin", label: "首页", icon: "home" },
  { href: "/admin/contacts", label: "联系人", icon: "contacts" },
  { href: "/admin/files", label: "文件", icon: "file" },
  { href: "/admin/settings", label: "设置", icon: "settings" },
] as const;

export function MobileNav({ active }: Readonly<{ active?: string | undefined }>) {
  return <nav aria-label="移动端主导航" className="dls-mobile-nav">{items.map((item) => <Link aria-current={active === item.href ? "page" : undefined} href={item.href} key={item.href}><Icon name={item.icon} /><span>{item.label}</span></Link>)}</nav>;
}
