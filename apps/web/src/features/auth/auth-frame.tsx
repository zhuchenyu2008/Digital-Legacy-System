import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "../../components/brand/wordmark";

export function AuthFrame({
  children,
  description,
  title,
}: Readonly<{ children: ReactNode; description: string; title: string }>) {
  return (
    <main className="dls-auth-page">
      <header>
        <Wordmark />
        <Link href="/">返回公开首页</Link>
      </header>
      <section className="dls-auth-panel dls-enter">
        <div>
          <p className="dls-eyebrow">DIGITAL LEGACY SYSTEM</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
    </main>
  );
}
