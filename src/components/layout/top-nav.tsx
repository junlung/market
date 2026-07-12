import Link from "next/link";
import type { Route } from "next";
import { Coins, Plus } from "lucide-react";
import { requireSession } from "@/lib/session";
import { formatPoints } from "@/lib/format";
import { ensureWeeklyAllowance, hasCurrentWeekAllowance } from "@/lib/server/allowance-service";
import { getUserBalance } from "@/lib/server/market-service";
import { NavLinks } from "@/components/layout/nav-links";
import { SearchBox } from "@/components/layout/search-box";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { buttonClasses } from "@/components/ui/button";

const NAV_LINKS: Array<{ href: Route; label: string }> = [
  { href: "/dashboard", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/activity", label: "Activity" },
];

export async function TopNav() {
  const session = await requireSession();

  // the nav renders on every signed-in page, so this is the single hook point
  // that lazily credits the weekly allowance on first activity of the week
  await ensureWeeklyAllowance(session.user.id);

  const [balance, allowanceLanded] = await Promise.all([
    getUserBalance(session.user.id),
    hasCurrentWeekAllowance(session.user.id),
  ]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/dashboard" className="shrink-0 text-base font-bold tracking-tight">
          Prolly<span className="text-primary">Market</span>
        </Link>

        <SearchBox />

        <div className="flex-1" />

        <NavLinks links={NAV_LINKS} />

        <Link href="/markets/new" className={buttonClasses("primary", "sm", "max-md:hidden")}>
          <Plus className="size-4" aria-hidden /> Propose
        </Link>

        <Link
          href="/account"
          title={allowanceLanded ? "This week's allowance is in" : "Balance"}
          className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors hover:bg-border"
        >
          <Coins className="size-4 text-warn" aria-hidden />
          {formatPoints(balance)}
          {allowanceLanded ? <span className="size-1.5 rounded-full bg-yes" aria-label="Weekly allowance received" /> : null}
        </Link>

        <ThemeToggle />

        <UserMenu
          name={session.user.name ?? "Player"}
          username={session.user.username}
          isAdmin={session.user.role === "ADMIN"}
        />
      </div>
    </header>
  );
}
