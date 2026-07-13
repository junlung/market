import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";
import { requireSession } from "@/lib/session";
import { ensureWeeklyAllowance, hasCurrentWeekAllowance } from "@/lib/server/allowance-service";
import { getGemBalance } from "@/lib/server/gem-service";
import { getUserCosmetics } from "@/lib/server/item-service";
import { getLeagueStacks } from "@/lib/server/league-service";
import { getUserBalance } from "@/lib/server/market-service";
import { BalanceMenu } from "@/components/layout/balance-menu";
import { NavLinks } from "@/components/layout/nav-links";
import { SearchBox } from "@/components/layout/search-box";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { buttonClasses } from "@/components/ui/button";

const NAV_LINKS: Array<{ href: Route; label: string }> = [
  { href: "/dashboard", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/leagues", label: "Leagues" },
  { href: "/activity", label: "Activity" },
];

export async function TopNav() {
  const session = await requireSession();

  // the nav renders on every signed-in page, so this is the single hook point
  // that lazily credits the weekly allowance on first activity of the week
  await ensureWeeklyAllowance(session.user.id);

  const [balance, allowanceLanded, leagueStacks, gems, viewerCosmetics] = await Promise.all([
    getUserBalance(session.user.id),
    hasCurrentWeekAllowance(session.user.id),
    getLeagueStacks(session.user.id),
    getGemBalance(session.user.id),
    getUserCosmetics(session.user.id),
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

        <BalanceMenu
          globalBalance={balance}
          allowanceLanded={allowanceLanded}
          leagues={leagueStacks}
          gems={gems}
        />

        <ThemeToggle />

        <UserMenu
          name={session.user.name ?? "Player"}
          username={session.user.username}
          isAdmin={session.user.role === "ADMIN"}
          frame={viewerCosmetics.frame}
        />
      </div>
    </header>
  );
}
