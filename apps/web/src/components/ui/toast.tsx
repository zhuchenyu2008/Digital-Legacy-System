import type { ReactNode } from "react";

export function Toast({
  children,
  tone = "info",
}: Readonly<{ children: ReactNode; tone?: "info" | "success" | "error" }>) {
  return (
    <div
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`dls-toast dls-toast--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
