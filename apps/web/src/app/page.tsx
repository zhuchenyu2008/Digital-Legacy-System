import Link from "next/link";
import { Wordmark } from "../components/brand/wordmark";
import { Icon } from "../components/icons/icon";
import { PublicStatus, type PublicStatusData } from "../features/public/public-status";
import { serverApiRequest } from "../lib/api/server-client";

const deathNav = [
  { href: "/", label: "首页" },
  { href: "/contact/login", label: "联系人" },
  { href: "/admin/files", label: "文件" },
  { href: "/admin/settings", label: "设置" },
] as const;

export default async function HomePage() {
  const response = await serverApiRequest<PublicStatusData>("/public/status");
  const status = response.data ?? { state: response.status >= 500 ? "UNAVAILABLE" : "NORMAL" };
  const workflowInProgress = status.state === "IN_PROGRESS";

  return (
    <div className={`dls-public-home dls-public-home--${status.state.toLowerCase()}`}>
      <header className={workflowInProgress ? "dls-public-death-header" : undefined}>
        <div className="dls-public-header-inner">
          <Wordmark />
          {workflowInProgress ? (
            <>
              <nav aria-label="公开状态导航">
                {deathNav.map((item) => (
                  <Link
                    aria-current={item.href === "/" ? "page" : undefined}
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="dls-public-death-actions">
                <span className="dls-public-death-status">
                  <i aria-hidden="true" />
                  ARMED - 确认中
                </span>
                <Link aria-label="通知" className="dls-header-notifications" href="/login">
                  <Icon name="notification" />
                </Link>
                <Link aria-label="管理员登录" href="/login">
                  <Icon name="user" />
                </Link>
              </div>
            </>
          ) : (
            <nav>
              <Link href="/contact/login">联系人登录</Link>
              <Link href="/login">管理员登录</Link>
            </nav>
          )}
        </div>
      </header>
      <main>
        <PublicStatus status={status} />
      </main>
      <nav className="dls-public-mobile-nav" aria-label="公开页面导航">
        {(workflowInProgress
          ? deathNav
          : [
              { href: "/", label: "首页" },
              { href: "/contact/login", label: "联系人" },
              { href: "/legal", label: "说明" },
              { href: "/login", label: "登录" },
            ]
        ).map((item, index) => (
          <Link aria-current={index === 0 ? "page" : undefined} href={item.href} key={item.href}>
            <Icon
              name={
                [
                  "home",
                  "contacts",
                  index === 2 && workflowInProgress ? "file" : "audit",
                  index === 3 && workflowInProgress ? "settings" : "user",
                ][index] ?? "home"
              }
            />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
