"use client";

import { type ReactNode, useEffect, useRef } from "react";

export function Dialog({
  children,
  description,
  onClose,
  open,
  title,
}: Readonly<{
  children: ReactNode;
  description: string;
  onClose?: () => void;
  open: boolean;
  title: string;
}>) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = dialogRef.current;
    const focusable = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ];
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose, open]);
  if (!open) return null;
  const id = title.toLowerCase().replace(/\s+/gu, "-");
  return (
    <div className="dls-dialog-backdrop">
      <section
        aria-describedby={`${id}-description`}
        aria-labelledby={`${id}-title`}
        aria-modal="true"
        className="dls-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-description`}>{description}</p>
        {children}
      </section>
    </div>
  );
}
