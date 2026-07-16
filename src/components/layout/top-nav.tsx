import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ensureWeeklyAllowance, hasCurrentWeekAllowance } from "@/lib/server/allowance-service";
import { getGemBalance } from "@/lib/server/gem-service";
import { getUserCosmetics } from "@/lib/server/item-service";
import { getLeagueStacks } from "@/lib/server/league-service";
import { getUserBalance } from "@/lib/server/market-service";
import { BalanceMenu } from "@/components/layout/balance-menu";
import { NAV_LINKS } from "@/components/layout/nav-config";
import { NavLinks } from "@/components/layout/nav-links";
import { SearchBox } from "@/components/layout/search-box";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/ui/theme-toggle";

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
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <div className="flex shrink-0 items-center gap-1.5">
          <Link href="/dashboard" className="text-base font-bold tracking-tight">
            Prolly<span className="text-primary">Market</span>
          </Link>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Beta
          </span>
        </div>

        <SearchBox />

        <div className="flex-1" />

        <NavLinks links={NAV_LINKS} />

        <BalanceMenu
          globalBalance={balance}
          allowanceLanded={allowanceLanded}
          leagues={leagueStacks}
          gems={gems}
        />

        {/* issue #3: the notification bell mounts here, between BalanceMenu and ThemeToggle */}
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
