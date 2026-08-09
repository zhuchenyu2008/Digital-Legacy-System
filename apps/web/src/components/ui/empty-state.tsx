import type { ReactNode } from "react";

export function EmptyState({
  action,
  description,
  title,
}: Readonly<{ action?: ReactNode; description: string; title: string }>) {
  return (
    <section className="dls-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
