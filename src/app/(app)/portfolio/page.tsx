import { LocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import type { Route } from "next";
import { ReceiptText, Wallet } from "lucide-react";
import clsx from "clsx";
import { LeagueChip } from "@/components/leagues/league-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProbabilityChip } from "@/components/ui/probability-chip";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import { buttonClasses } from "@/components/ui/button";
import { OutcomeDot } from "@/components/markets/outcome-dot";
import { formatPoints, formatSignedPoints } from "@/lib/format";
import { marketPath } from "@/lib/leagues";
import { outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";
import { getActiveStakes, getBetHistory, getResolvedStakes } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

type ActiveStakes = Awaited<ReturnType<typeof getActiveStakes>>;
type ResolvedStakes = Awaited<ReturnType<typeof getResolvedStakes>>;
type BetHistory = Awaited<ReturnType<typeof getBetHistory>>;

export default async function PortfolioPage() {
  const session = await requireSession();
  const [active, resolved, bets] = await Promise.all([
    getActiveStakes(session.user.id),
    getResolvedStakes(session.user.id),
    getBetHistory(session.user.id),
  ]);

  const atStake = active.reduce((sum, stake) => sum + stake.staked, 0);
  const ifAllHit = active.reduce((sum, stake) => sum + stake.ifAllWon, 0);
  const lifetimeProfit = resolved.reduce((sum, stake) => sum + stake.profit, 0);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Portfolio"
        description="Your live stakes, settled results, and full bet log — Global League and your leagues together."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="At stake"
          value={`${formatPoints(atStake)} pts`}
          hint={`${active.length} live market${active.length === 1 ? "" : "s"}, all leagues`}
        />
        <StatCard
          label="If everything hits"
          value={`${formatPoints(ifAllHit)} pts`}
          hint="At current odds — pools move"
        />
        <StatCard
          label="Lifetime P/L"
          value={`${formatSignedPoints(lifetimeProfit)} pts`}
          tone={lifetimeProfit > 0 ? "yes" : lifetimeProfit < 0 ? "no" : "default"}
          hint="Across settled markets"
        />
      </div>

      <Tabs
        tabs={[
          { id: "positions", label: "Positions" },
          { id: "history", label: "Bet history", count: bets.length },
        ]}
        panels={{
          positions: <PositionsPanel active={active} resolved={resolved} />,
          history: <BetHistoryPanel bets={bets} />,
        }}
      />
    </section>
  );
}

function PositionsPanel({ active, resolved }: { active: ActiveStakes; resolved: ResolvedStakes }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">Active</h2>
        {active.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nothing at stake"
            description="You've got points burning a hole in your pocket."
            action={
              <Link href="/dashboard" className={buttonClasses("primary", "sm")}>
                Browse markets
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {active.map((stake) => (
              <Link
                key={stake.marketId}
                href={marketPath(stake.league, stake.marketId) as Route}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{stake.title}</span>
                    <LeagueChip league={stake.league} />
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted tabular-nums">
                    {stake.positions.map((position) => (
                      <span key={position.outcomeId} className="inline-flex items-center gap-1.5">
                        <OutcomeDot color={position.color} />
                        <span
                          className="max-w-28 truncate font-semibold"
                          style={{ color: outcomeColorVar(position.color) }}
                        >
                          {outcomeDisplayLabel(position)}
                        </span>{" "}
                        {formatPoints(position.amount)} pts
                        {" · if it hits "}
                        <span className="font-semibold text-foreground">
                          {formatSignedPoints(position.ifWon - position.amount)}
                        </span>
                      </span>
                    ))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {stake.status === "CLOSED" ? <StatusBadge label="closed" /> : null}
                  {stake.leaderTied ? (
                    <ProbabilityChip probability={stake.leader.probability} neutral label="even" size="md" showLabel />
                  ) : (
                    <ProbabilityChip
                      probability={stake.leader.probability}
                      color={stake.leader.color}
                      label={outcomeDisplayLabel(stake.leader)}
                      size="md"
                      showLabel
                    />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">Settled</h2>
        {resolved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
            No settled markets yet.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {resolved.map((stake) => (
              <Link
                key={stake.marketId}
                href={marketPath(stake.league, stake.marketId) as Route}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{stake.title}</span>
                    <LeagueChip league={stake.league} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {stake.resolvedAt ? <LocalTime date={stake.resolvedAt} /> : ""} · staked{" "}
                    {formatPoints(stake.staked)} pts
                    {stake.winningLabel ? ` · winner: ${stake.winningLabel}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge label={stake.canceled ? "refunded" : stake.won ? "won" : "lost"} />
                  <span
                    className={clsx(
                      "text-sm font-bold tabular-nums",
                      stake.profit > 0 ? "text-yes" : stake.profit < 0 ? "text-no" : "text-muted",
                    )}
                  >
                    {formatSignedPoints(stake.profit)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BetHistoryPanel({ bets }: { bets: BetHistory }) {
  if (bets.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No bets yet"
        description="Your betting record starts with your first stake."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
            <th className="px-4 py-2.5 font-medium">Market</th>
            <th className="px-4 py-2.5 font-medium">Pick</th>
            <th className="px-4 py-2.5 text-right font-medium">Stake</th>
            <th className="px-4 py-2.5 text-right font-medium">Odds after</th>
            <th className="px-4 py-2.5 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {bets.map((bet) => (
            <tr key={bet.id} className="transition-colors hover:bg-surface-2">
              <td className="max-w-64 px-4 py-2.5">
                <span className="flex items-center gap-2">
                  <Link
                    href={marketPath(bet.market.league, bet.market.id) as Route}
                    className="line-clamp-1 min-w-0 font-medium hover:text-primary"
                  >
                    {bet.market.title}
                  </Link>
                  <LeagueChip league={bet.market.league} />
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-1.5">
                  <OutcomeDot color={bet.outcome.color} />
                  <span
                    className="max-w-32 truncate font-bold"
                    style={{ color: outcomeColorVar(bet.outcome.color) }}
                  >
                    {outcomeDisplayLabel(bet.outcome)}
                  </span>
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                {formatPoints(bet.amount)} pts
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                {bet.totalPoolAfter > 0
                  ? `${Math.round((bet.outcomePoolAfter / bet.totalPoolAfter) * 100)}%`
                  : "—"}
              </td>
              <td className="px-4 py-2.5 text-right text-xs text-muted">
                <LocalTime date={bet.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
