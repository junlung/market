import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import { Compass, Plus, Wrench } from "lucide-react";
import { MarketCard } from "@/components/markets/market-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalTime } from "@/components/ui/local-time";
import { getMarketStatusLabel } from "@/lib/markets";
import { outcomeDisplayLabel } from "@/lib/outcome-colors";
import { canOperateLeague, getLeagueForViewer } from "@/lib/server/league-service";
import {
  getDashboardMarkets,
  listLeagueMarketsAwaitingAction,
  listLeagueSettledMarkets,
} from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

export default async function LeagueMarketsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const { slug } = await params;
  const result = await getLeagueForViewer(slug, session.user.id);
  if (!result || result.league.isGlobal) {
    notFound();
  }
  const { league } = result;

  const [open, canManage, needsAction, settled] = await Promise.all([
    getDashboardMarkets(session.user.id, { leagueId: league.id }),
    canOperateLeague(league.id, session.user.id),
    listLeagueMarketsAwaitingAction(league.id),
    listLeagueSettledMarkets(league.id),
  ]);

  const base = `/l/${slug}/markets`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Open markets</h2>
        <Link href={`${base}/new` as Route} className={buttonClasses("primary", "sm")}>
          <Plus className="size-4" aria-hidden /> {canManage ? "New market" : "Propose a market"}
        </Link>
      </div>

      {open.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="No open markets"
          description={
            canManage
              ? "Open one — the group can't bet on nothing."
              : "Nothing to bet on yet. Propose something."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {open.map((market) => (
            <MarketCard key={market.id} market={market} hrefBase={base} />
          ))}
        </div>
      )}

      {canManage && needsAction.length > 0 ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Wrench className="size-4 text-warn" aria-hidden /> Needs your action
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-warn/40 bg-surface">
            {needsAction.map((market) => (
              <li key={market.id}>
                <Link
                  href={`${base}/${market.id}` as Route}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate font-medium">{market.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <StatusBadge label={getMarketStatusLabel(market.status)} />
                    <LocalTime date={market.closeTime} mode="date" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {settled.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Recently settled</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {settled.map((market) => (
              <li key={market.id}>
                <Link
                  href={`${base}/${market.id}` as Route}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate">{market.title}</span>
                  <span className="shrink-0 text-xs font-medium text-muted">
                    {market.status === MarketStatus.CANCELED
                      ? "Canceled"
                      : market.winningOutcome
                        ? `→ ${outcomeDisplayLabel(market.winningOutcome)}`
                        : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
