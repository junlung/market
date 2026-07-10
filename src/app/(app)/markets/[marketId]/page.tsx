import { notFound } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import { Flame, ScrollText, Trophy, Users } from "lucide-react";
import { ActivityList } from "@/components/markets/activity-row";
import { BetSlip } from "@/components/markets/bet-slip";
import { ViewerPositionCard } from "@/components/markets/viewer-position";
import { CommentThread } from "@/components/markets/comment-thread";
import { OddsChart } from "@/components/markets/odds-chart";
import { PositionsTable } from "@/components/markets/positions-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ProbabilityChip } from "@/components/ui/probability-chip";
import { CountdownBadge } from "@/components/ui/countdown-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import {
  formatChance,
  formatCompactPoints,
  formatDateTime,
  formatPoints,
  formatSignedPoints,
} from "@/lib/format";
import { getMarketStatusLabel } from "@/lib/markets";
import { getMarketDetail, getUserBalance } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

type Props = {
  params: Promise<{ marketId: string }>;
  searchParams: Promise<{ side?: string; tab?: string }>;
};

export default async function MarketDetailPage({ params, searchParams }: Props) {
  const session = await requireSession();
  const { marketId } = await params;
  const { side } = await searchParams;

  const [market, balance] = await Promise.all([
    getMarketDetail(marketId, session.user.id),
    getUserBalance(session.user.id),
  ]);

  if (!market || market.status === MarketStatus.REJECTED) {
    notFound();
  }

  const isOpen = market.status === MarketStatus.OPEN && market.closeTime > new Date();
  const isSettled = market.status === MarketStatus.RESOLVED || market.status === MarketStatus.CANCELED;
  const viewerStakeTotal = (market.viewerStake?.yesStake ?? 0) + (market.viewerStake?.noStake ?? 0);

  const openingProbability = market.oddsHistory[0]?.p ?? 0.5;
  const delta = Math.round((market.yesProbability - openingProbability) * 100);

  const viewerSettled =
    market.positions.find((position) => position.userId === session.user.id) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
              {market.category}
            </span>
            <StatusBadge label={getMarketStatusLabel(market.status)} />
            {isOpen ? <CountdownBadge closeTime={market.closeTime} /> : null}
          </div>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{market.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Trophy className="size-3.5 text-warn" aria-hidden />
              {formatCompactPoints(market.pot)} pt pot
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="size-3.5" aria-hidden />
              {market.participantCount} bettor{market.participantCount === 1 ? "" : "s"}
            </span>
            <span>Closes {formatDateTime(market.closeTime)}</span>
            <span>Resolves {formatDateTime(market.resolveTime)}</span>
          </div>
        </div>

        {isSettled ? (
          <div
            className={
              market.finalOutcome === "YES"
                ? "rounded-xl bg-yes-bg p-4 text-yes"
                : market.finalOutcome === "NO"
                  ? "rounded-xl bg-no-bg p-4 text-no"
                  : "rounded-xl bg-surface-2 p-4 text-muted"
            }
          >
            <p className="text-lg font-bold">
              {market.finalOutcome === "CANCELED"
                ? "Canceled — all stakes refunded"
                : `Resolved ${market.finalOutcome} ✓`}
            </p>
            {market.resolution ? (
              <p className="mt-1 text-xs opacity-80">
                {market.resolution.notes || market.resolution.resolutionSource}
                {market.resolution.rakeAmount > 0
                  ? ` · ${formatPoints(market.resolution.rakeAmount + market.resolution.dustAmount)} pts burned (rake)`
                  : ""}
              </p>
            ) : null}
            {viewerSettled ? (
              <p className="mt-1 text-sm font-semibold tabular-nums">
                You: {formatSignedPoints(viewerSettled.profit)} pts
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <ProbabilityChip probability={market.yesProbability} size="xl" showLabel />
            {market.betCount > 0 && delta !== 0 ? (
              <span
                className={
                  delta > 0 ? "pb-4 text-sm font-semibold text-yes" : "pb-4 text-sm font-semibold text-no"
                }
              >
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} pts since open
              </span>
            ) : null}
          </div>
        )}

        {market.betCount > 0 ? (
          <OddsChart
            points={market.oddsHistory}
            endTime={Math.min(market.closeTime.getTime(), Date.now())}
          />
        ) : (
          <EmptyState
            icon={Flame}
            title="No bets yet"
            description="The pool opens at 50/50. First bet moves the odds."
          />
        )}

        <div className="space-y-4 lg:hidden">
          {isOpen ? (
            <BetSlip
              marketId={market.id}
              yesPool={market.yesPool}
              noPool={market.noPool}
              rakeBps={market.rakeBps}
              maxStakePerUser={market.maxStakePerUser}
              balance={balance}
              viewerStakeTotal={viewerStakeTotal}
              initialSide={side === "NO" ? "NO" : side === "YES" ? "YES" : undefined}
            />
          ) : null}
          {market.viewerStake && viewerStakeTotal > 0 && !isSettled ? (
            <ViewerPositionCard
              yesStake={market.viewerStake.yesStake}
              noStake={market.viewerStake.noStake}
              yesPool={market.yesPool}
              noPool={market.noPool}
              rakeBps={market.rakeBps}
            />
          ) : null}
        </div>

        <Tabs
          tabs={[
            { id: "activity", label: "Activity", count: market.betCount },
            { id: "comments", label: "Comments", count: market.comments.length },
            { id: "positions", label: "Positions", count: market.positions.length },
            { id: "rules", label: "Rules" },
          ]}
          panels={{
            activity:
              market.activity.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Nothing yet — first bet takes the lead.</p>
              ) : (
                <ActivityList items={market.activity} />
              ),
            comments: (
              <CommentThread
                marketId={market.id}
                comments={market.comments}
                viewerName={session.user.name ?? "You"}
              />
            ),
            positions: (
              <PositionsTable rows={market.positions} viewerId={session.user.id} settled={isSettled} />
            ),
            rules: (
              <div className="space-y-4 text-sm">
                <p className="whitespace-pre-wrap leading-relaxed">{market.description}</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-surface-2 p-3">
                    <dt className="flex items-center gap-1.5 text-xs font-medium text-faint">
                      <ScrollText className="size-3.5" aria-hidden /> Resolution source
                    </dt>
                    <dd className="mt-1">{market.resolutionSource}</dd>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-3">
                    <dt className="text-xs font-medium text-faint">Betting closes</dt>
                    <dd className="mt-1">{formatDateTime(market.closeTime)}</dd>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-3">
                    <dt className="text-xs font-medium text-faint">Resolves by</dt>
                    <dd className="mt-1">{formatDateTime(market.resolveTime)}</dd>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-3">
                    <dt className="text-xs font-medium text-faint">The fine print</dt>
                    <dd className="mt-1 text-muted">
                      Winners split the losing pool pro-rata to stake.{" "}
                      {market.rakeBps > 0
                        ? `${market.rakeBps / 100}% of the losing pool is burned — the house always wins a little.`
                        : "No rake on this one."}{" "}
                      Max {formatPoints(market.maxStakePerUser)} pts per player.
                    </dd>
                  </div>
                </dl>
              </div>
            ),
          }}
        />
      </div>

      <div className="hidden lg:block">
        <div className="sticky top-[72px] space-y-4">
          {isOpen ? (
            <BetSlip
              marketId={market.id}
              yesPool={market.yesPool}
              noPool={market.noPool}
              rakeBps={market.rakeBps}
              maxStakePerUser={market.maxStakePerUser}
              balance={balance}
              viewerStakeTotal={viewerStakeTotal}
              initialSide={side === "NO" ? "NO" : side === "YES" ? "YES" : undefined}
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface p-5 text-center">
              <p className="text-sm font-semibold">
                {isSettled ? "This one's in the books" : "Betting closed"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {isSettled
                  ? market.finalOutcome === "CANCELED"
                    ? "All stakes were refunded."
                    : `Resolved ${market.finalOutcome}.`
                  : `Resolves ${formatDateTime(market.resolveTime)}.`}
              </p>
            </div>
          )}

          {market.viewerStake && viewerStakeTotal > 0 && !isSettled ? (
            <ViewerPositionCard
              yesStake={market.viewerStake.yesStake}
              noStake={market.viewerStake.noStake}
              yesPool={market.yesPool}
              noPool={market.noPool}
              rakeBps={market.rakeBps}
            />
          ) : null}

          <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">
            <p className="flex justify-between tabular-nums">
              <span>Yes pool</span>
              <span className="font-semibold text-yes">{formatPoints(market.yesPool)} pts</span>
            </p>
            <p className="mt-1 flex justify-between tabular-nums">
              <span>No pool</span>
              <span className="font-semibold text-no">{formatPoints(market.noPool)} pts</span>
            </p>
            <p className="mt-1 flex justify-between tabular-nums">
              <span>Implied chance</span>
              <span className="font-semibold text-foreground">
                {formatChance(market.yesProbability)} yes
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
