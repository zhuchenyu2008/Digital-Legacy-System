import Link from "next/link";

export function Wordmark({ href = "/" }: Readonly<{ href?: string }>) {
  return (
    <Link aria-label="Digital Legacy 首页" className="dls-wordmark" href={href}>
      Digital Legacy
    </Link>
  );
}
