import { notFound } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import { Flame, ScrollText, Trophy, Users } from "lucide-react";
import { ActivityList } from "@/components/markets/activity-row";
import { BetSlip } from "@/components/markets/bet-slip";
import { ViewerPositionCard } from "@/components/markets/viewer-position";
import { CommentThread } from "@/components/markets/comment-thread";
import { OddsChart } from "@/components/markets/odds-chart";
import { OutcomeDot } from "@/components/markets/outcome-dot";
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
import { outcomeColorBg, outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";
import { getMarketDetail, getUserBalance } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

type Props = {
  params: Promise<{ marketId: string }>;
  searchParams: Promise<{ side?: string; outcome?: string; tab?: string }>;
};

export default async function MarketDetailPage({ params, searchParams }: Props) {
  const session = await requireSession();
  const { marketId } = await params;
  const { side, outcome: outcomeParam } = await searchParams;

  const [market, balance] = await Promise.all([
    getMarketDetail(marketId, session.user.id),
    getUserBalance(session.user.id),
  ]);

  if (!market || market.status === MarketStatus.REJECTED) {
    notFound();
  }

  const isOpen = market.status === MarketStatus.OPEN && market.closeTime > new Date();
  const isCanceled = market.status === MarketStatus.CANCELED;
  const isSettled = market.status === MarketStatus.RESOLVED || isCanceled;
  const isBinary = market.outcomes.length === 2;
  const viewerStakeTotal = market.viewerStakes.reduce((sum, stake) => sum + stake.amount, 0);

  // legacy ?side=YES|NO deep links map to sortOrder 0/1
  const sideOutcomeId =
    side === "YES" ? market.outcomes[0]?.id : side === "NO" ? market.outcomes[1]?.id : undefined;
  const initialOutcomeId =
    market.outcomes.find((candidate) => candidate.id === outcomeParam)?.id ?? sideOutcomeId;

  const headline = isBinary ? market.outcomes[0] : market.leader;
  const openingProbability = market.oddsHistory[0]?.probs[headline.sortOrder] ?? 0;
  const delta = Math.round((headline.probability - openingProbability) * 100);

  const viewerSettled =
    market.positions.find((position) => position.userId === session.user.id) ?? null;

  const betSlip = (
    <BetSlip
      marketId={market.id}
      outcomes={market.outcomes.map((outcome) => ({
        id: outcome.id,
        label: outcome.label,
        color: outcome.color,
        emoji: outcome.emoji,
        pool: outcome.pool,
      }))}
      rakeBps={market.rakeBps}
      maxStakePerUser={market.maxStakePerUser}
      balance={balance}
      viewerStakeTotal={viewerStakeTotal}
      initialOutcomeId={initialOutcomeId}
    />
  );

  const viewerPosition =
    market.viewerStakes.length > 0 && !isSettled ? (
      <ViewerPositionCard
        stakes={market.viewerStakes}
        outcomes={market.outcomes}
        rakeBps={market.rakeBps}
      />
    ) : null;

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
            className="rounded-xl p-4"
            style={
              isCanceled
                ? undefined
                : {
                    background: outcomeColorBg(market.winningOutcome?.color ?? "blue", 12),
                    color: outcomeColorVar(market.winningOutcome?.color ?? "blue"),
                  }
            }
          >
            <p className={isCanceled ? "text-lg font-bold text-muted" : "text-lg font-bold"}>
              {isCanceled
                ? "Canceled — all stakes refunded"
                : `Resolved: ${market.winningOutcome ? outcomeDisplayLabel(market.winningOutcome) : ""} ✓`}
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
            {isBinary ? (
              <ProbabilityChip probability={headline.probability} size="xl" showLabel />
            ) : (
              <ProbabilityChip
                probability={headline.probability}
                color={headline.color}
                label={outcomeDisplayLabel(headline)}
                size="xl"
                showLabel
              />
            )}
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
            outcomes={market.outcomes}
            points={market.oddsHistory}
            endTime={Math.min(market.closeTime.getTime(), Date.now())}
          />
        ) : (
          <EmptyState
            icon={Flame}
            title="No bets yet"
            description={`The pool opens at ${formatChance(1 / market.outcomes.length)} per outcome. First bet moves the odds.`}
          />
        )}

        <div className="space-y-4 lg:hidden">
          {isOpen ? betSlip : null}
          {viewerPosition}
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
              <PositionsTable
                rows={market.positions}
                outcomes={market.outcomes}
                viewerId={session.user.id}
                settled={isSettled}
              />
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
                      Exactly one outcome wins; winners split everyone else&apos;s points pro-rata
                      to stake.{" "}
                      {market.rakeBps > 0
                        ? `${market.rakeBps / 100}% of the losing pools is burned — the house always wins a little.`
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
            betSlip
          ) : (
            <div className="rounded-xl border border-border bg-surface p-5 text-center">
              <p className="text-sm font-semibold">
                {isSettled ? "This one's in the books" : "Betting closed"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {isSettled
                  ? isCanceled
                    ? "All stakes were refunded."
                    : `Resolved: ${market.winningOutcome ? outcomeDisplayLabel(market.winningOutcome) : ""}.`
                  : `Resolves ${formatDateTime(market.resolveTime)}.`}
              </p>
            </div>
          )}

          {viewerPosition}

          <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">
            {market.outcomes.map((outcome) => (
              <p key={outcome.id} className="mt-1 flex items-center justify-between gap-2 tabular-nums first:mt-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <OutcomeDot color={outcome.color} />
                  <span className="truncate">{outcomeDisplayLabel(outcome)}</span>
                </span>
                <span className="shrink-0">
                  <span className="font-semibold" style={{ color: outcomeColorVar(outcome.color) }}>
                    {formatPoints(outcome.pool)} pts
                  </span>{" "}
                  · {formatChance(outcome.probability)}
                </span>
              </p>
            ))}
            <p className="mt-2 flex justify-between border-t border-border pt-2 tabular-nums">
              <span>Total pot</span>
              <span className="font-semibold text-foreground">{formatPoints(market.pot)} pts</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
