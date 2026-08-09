import type { ReactNode } from "react";
import { DesktopNav } from "./desktop-nav.js";
import { MobileNav } from "./mobile-nav.js";

export function AdminShell({ active, children, status }: Readonly<{ active?: string | undefined; children: ReactNode; status?: string | undefined }>) {
  return <div className="dls-app-shell"><DesktopNav active={active} status={status} /><div className="dls-mobile-brand"><DesktopNav active={active} status={status} /></div><main className="dls-workspace">{children}</main><MobileNav active={active} /></div>;
}
