"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export function NavLinks({ links }: { links: Array<{ href: Route; label: string }> }) {
  const pathname = usePathname();

  // lg, not md: six links + the right cluster overflow tablet widths, so
  // 768-1023px uses the mobile tab bar instead (see mobile-tab-bar.tsx)
  return (
    <nav className="hidden items-center gap-1 lg:flex">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
