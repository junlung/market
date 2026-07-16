"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import clsx from "clsx";

// exact: the dashboard would otherwise stay lit on every /admin/* page
const ADMIN_TABS: Array<{ href: Route; label: string; exact?: boolean }> = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/markets", label: "Markets" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/items", label: "Items" },
  { href: "/admin/feedback", label: "Feedback" },
];

export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b border-border">
      {ADMIN_TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
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
