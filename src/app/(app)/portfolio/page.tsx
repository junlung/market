import Link from "next/link";
import { Wallet } from "lucide-react";
import clsx from "clsx";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ProbabilityChip } from "@/components/ui/probability-chip";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClasses } from "@/components/ui/button";
import { OutcomeDot } from "@/components/markets/outcome-dot";
import { formatDateTime, formatPoints, formatSignedPoints } from "@/lib/format";
import { outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";
import { getActiveStakes, getResolvedStakes } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

export default async function PortfolioPage() {
  const session = await requireSession();
  const [active, resolved] = await Promise.all([
    getActiveStakes(session.user.id),
    getResolvedStakes(session.user.id),
  ]);

  const atStake = active.reduce((sum, stake) => sum + stake.staked, 0);
  const ifAllHit = active.reduce((sum, stake) => sum + stake.ifAllWon, 0);
  const lifetimeProfit = resolved.reduce((sum, stake) => sum + stake.profit, 0);

  return (
    <section className="space-y-5">
      <PageHeader title="Portfolio" description="Your live stakes and settled results." />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="At stake"
          value={`${formatPoints(atStake)} pts`}
          hint={`${active.length} live market${active.length === 1 ? "" : "s"}`}
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
                href={`/markets/${stake.marketId}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{stake.title}</p>
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
                href={`/markets/${stake.marketId}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{stake.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {stake.resolvedAt ? formatDateTime(stake.resolvedAt) : ""} · staked{" "}
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
    </section>
  );
}
