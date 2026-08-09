import type { ReactNode } from "react";

export function Dialog({ children, description, open, title }: Readonly<{ children: ReactNode; description: string; open: boolean; title: string }>) {
  if (!open) return null;
  const id = title.toLowerCase().replace(/\s+/gu, "-");
  return (
    <div className="dls-dialog-backdrop">
      <section aria-describedby={`${id}-description`} aria-labelledby={`${id}-title`} aria-modal="true" className="dls-dialog" role="dialog">
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-description`}>{description}</p>
        {children}
      </section>
    </div>
  );
}
