import Link from "next/link";
import { Compass, Gift, TrendingUp, Trophy } from "lucide-react";
import { CategoryTabs } from "@/components/markets/category-tabs";
import { MarketCard } from "@/components/markets/market-card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { formatPoints, formatRelativeTime } from "@/lib/format";
import { getNextIsoWeekStart } from "@/lib/allowance";
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

  const [markets, categories, leaderboard, balance] = await Promise.all([
    getDashboardMarkets(session.user.id, { category, query: q }),
    getOpenCategories(),
    getLeaderboard(),
    getUserBalance(session.user.id),
  ]);

  const rank = leaderboard.findIndex((row) => row.userId === session.user.id) + 1;
  const nextAllowance = getNextIsoWeekStart(new Date());

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
      </div>

      <CategoryTabs categories={categories} active={category} query={q} />

      {markets.length === 0 ? (
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {markets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
