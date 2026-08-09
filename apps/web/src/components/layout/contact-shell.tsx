import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "../brand/wordmark";
import { Icon } from "../icons/icon";

export function ContactShell({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="dls-contact-shell"><header><Wordmark /><nav aria-label="联系人导航"><Link href="/contact/workflows/current">当前任务</Link><Link aria-label="联系人设置" href="/contact/password-change"><Icon name="settings" /></Link></nav></header><main>{children}</main></div>;
}
