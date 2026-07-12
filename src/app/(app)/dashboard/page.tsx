import Link from "next/link";
import type { Route } from "next";
import { Compass, Crown, Gift, Plus, TrendingUp, Trophy } from "lucide-react";
import { CategoryTabs } from "@/components/markets/category-tabs";
import { MarketCard } from "@/components/markets/market-card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { formatPoints, formatRelativeTime } from "@/lib/format";
import { getNextIsoWeekStart } from "@/lib/allowance";
import { listUserLeagues } from "@/lib/server/league-service";
import {
  getDashboardMarkets,
  getLeaderboard,
  getOpenCategories,
  getUserBalance,
} from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const session = await requireSession();
  const { category, q } = await searchParams;

  const [markets, categories, leaderboard, balance, myLeagues] = await Promise.all([
    getDashboardMarkets(session.user.id, { category, query: q }),
    getOpenCategories(),
    getLeaderboard(),
    getUserBalance(session.user.id),
    listUserLeagues(session.user.id),
  ]);

  // the same search/category filters apply inside each of the viewer's
  // leagues; leagues with nothing open (or nothing matching) stay out of view
  const leagueSections = (
    await Promise.all(
      myLeagues.map(async ({ league }) => ({
        league,
        markets: await getDashboardMarkets(session.user.id, {
          category,
          query: q,
          leagueId: league.id,
        }),
      })),
    )
  ).filter((section) => section.markets.length > 0);

  const rank = leaderboard.findIndex((row) => row.userId === session.user.id) + 1;
  const nextAllowance = getNextIsoWeekStart(new Date());
  const nothingAnywhere = markets.length === 0 && leagueSections.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
        <span className="text-lg font-semibold text-foreground">
          Hey {session.user.name?.split(" ")[0] ?? "player"} 👋
        </span>
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <TrendingUp className="size-4 text-primary" aria-hidden />
          {formatPoints(balance)} pts
        </span>
        {rank > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Trophy className="size-4 text-warn" aria-hidden />
            Rank #{rank}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Gift className="size-4 text-yes" aria-hidden />
          Next allowance {formatRelativeTime(nextAllowance)}
        </span>
        <span className="ml-auto">
          <Link href="/markets/new" className={buttonClasses("primary", "sm")}>
            <Plus className="size-4" aria-hidden /> Propose a market
          </Link>
        </span>
      </div>

      <CategoryTabs categories={categories} active={category} query={q} />

      {nothingAnywhere ? (
        <EmptyState
          icon={Compass}
          title={q || category ? "Nothing matches" : "No open markets"}
          description={
            q || category
              ? "Try a different search or category."
              : "The pools are quiet. Propose a market and start the action."
          }
          action={
            <Link href="/markets/new" className={buttonClasses("primary", "sm")}>
              Propose a market
            </Link>
          }
        />
      ) : markets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-sm text-muted">
          {q || category
            ? "No Global League markets match — but your leagues have some below."
            : "No open Global League markets right now — your leagues are live below."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {markets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}

      {leagueSections.map(({ league, markets: leagueMarkets }) => (
        <div key={league.id} className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Crown className="size-4 text-primary" aria-hidden />
              <Link href={`/l/${league.slug}` as Route} className="hover:text-primary">
                {league.name}
              </Link>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                League
              </span>
            </h2>
            <Link
              href={`/l/${league.slug}/markets` as Route}
              className="text-xs font-medium text-primary hover:underline"
            >
              All {league.name} markets →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {leagueMarkets.map((market) => (
              <MarketCard key={market.id} market={market} hrefBase={`/l/${league.slug}/markets`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
