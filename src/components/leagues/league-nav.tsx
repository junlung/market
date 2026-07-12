"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export function LeagueNav({ slug, canManage }: { slug: string; canManage: boolean }) {
  const pathname = usePathname();
  const base = `/l/${slug}`;

  const tabs: Array<{ href: string; label: string; exact?: boolean }> = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/markets`, label: "Markets" },
    { href: `${base}/leaderboard`, label: "Leaderboard" },
    ...(canManage ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href as Route}
            className={clsx(
              "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
