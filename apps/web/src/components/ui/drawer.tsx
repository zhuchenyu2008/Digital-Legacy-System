import type { ReactNode } from "react";

export function Drawer({
  children,
  label,
  open,
}: Readonly<{ children: ReactNode; label: string; open: boolean }>) {
  if (!open) return null;
  return (
    <aside aria-label={label} className="dls-drawer">
      {children}
    </aside>
  );
}
