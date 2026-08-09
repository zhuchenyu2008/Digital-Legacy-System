import type { ReactNode } from "react";

export function StatusBadge({
  children,
  tone = "neutral",
}: Readonly<{ children: ReactNode; tone?: "safe" | "warning" | "critical" | "neutral" }>) {
  return (
    <span className={`dls-status dls-status--${tone}`}>
      <span aria-hidden="true">●</span>
      {children}
    </span>
  );
}
