import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  Readonly<{
    children: ReactNode;
    tone?: "primary" | "secondary" | "danger" | "quiet";
    busy?: boolean;
  }>;

export function Button({ busy = false, children, className = "", disabled, tone = "primary", ...props }: ButtonProps) {
  return (
    <button
      aria-busy={busy || undefined}
      className={`dls-button dls-button--${tone} dls-interactive ${className}`.trim()}
      disabled={disabled || busy}
      type="button"
      {...props}
    >
      {busy ? <span aria-hidden="true" className="dls-spinner" /> : null}
      <span>{children}</span>
    </button>
  );
}
