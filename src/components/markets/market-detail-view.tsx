import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import { Flame, ScrollText, Shield, Trophy, Users } from "lucide-react";
import { marketStatusAction, updateMarketAction } from "@/app/actions/markets";
import { MarketForm } from "@/components/admin/market-form";
import { ProposalReview } from "@/components/admin/proposal-review";
import {
  ResolveMarketForm,
  type SettlementPreview,
} from "@/components/admin/resolve-market-form";
import { ActivityList } from "@/components/markets/activity-row";
import { BetSlip } from "@/components/markets/bet-slip";
import { CommentThread } from "@/components/markets/comment-thread";
import { OddsChart } from "@/components/markets/odds-chart";
import { OutcomeDot } from "@/components/markets/outcome-dot";
import { CloseMarketForm } from "@/components/markets/close-market-form";
import { PositionsTable } from "@/components/markets/positions-table";
import { ViewerPositionCard } from "@/components/markets/viewer-position";
import { Button } from "@/components/ui/button";
import { CountdownBadge } from "@/components/ui/countdown-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalTime } from "@/components/ui/local-time";
import { ProbabilityChip } from "@/components/ui/probability-chip";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import {
  formatChance,
  formatCompactPoints,
  formatPoints,
  formatSignedPoints,
} from "@/lib/format";
import { categoryDisplay, globalCategoryOptions, leagueCategoryOptions } from "@/lib/categories";
import { getMarketStatusLabel, isMarketEditable } from "@/lib/markets";
import {
  isYesNoMarket,
  outcomeColorBg,
  outcomeColorVar,
  outcomeDisplayLabel,
} from "@/lib/outcome-colors";
import { getUserCosmetics } from "@/lib/server/item-service";
import {
  canOperateLeague,
  getLeagueBalance,
  getLeagueMembership,
} from "@/lib/server/league-service";
import {
  getMarketDetail,
  getUserBalance,
  previewSettlement,
} from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

type Props = {
  marketId: string;
  side?: string;
  outcomeParam?: string;
  /**
   * Set on the league route (/l/[slug]/markets/[id]). Global markets 404
   * there; league markets viewed on the global route redirect here. Also
   * turns on the members-only gate and the operator manage panel.
   */
  expectedLeagueSlug?: string;
};

/**
 * The market page body, shared by /markets/[id] (Global League) and
 * /l/[slug]/markets/[id] (custom leagues). Every market has exactly one
 * canonical URL — the view redirects/404s mismatches instead of serving both.
 */
export async function MarketDetailView({ marketId, side, outcomeParam, expectedLeagueSlug }: Props) {
  const session = await requireSession();
  const market = await getMarketDetail(marketId, session.user.id);

  if (!market || market.status === MarketStatus.REJECTED) {
    notFound();
  }

  if (!expectedLeagueSlug && !market.league.isGlobal) {
    redirect(`/l/${market.league.slug}/markets/${market.id}` as Route);
  }
  if (expectedLeagueSlug && market.league.slug !== expectedLeagueSlug) {
    notFound();
  }

  // app admins pass everywhere via the requireLeagueRole short-circuit, so
  // this also lights up the manage panel on Global League markets
  const canOperate = await canOperateLeague(market.league.id, session.user.id);
  if (!market.league.isGlobal) {
    const membership = await getLeagueMembership(market.league.id, session.user.id);
    if (!membership && !canOperate) {
      notFound(); // league markets are members-only
    }
  }

  const balance = market.league.isGlobal
    ? await getUserBalance(session.user.id)
    : await getLeagueBalance(session.user.id, {
        leagueId: market.league.id,
        balancePolicy: market.league.balancePolicy,
        seasonId: market.seasonId,
      });

  const isOpen = market.status === MarketStatus.OPEN && market.closeTime > new Date();
  const isCanceled = market.status === MarketStatus.CANCELED;
  const isSettled = market.status === MarketStatus.RESOLVED || isCanceled;
  const classic = isYesNoMarket(market.outcomes);
  const viewerStakeTotal = market.viewerStakes.reduce((sum, stake) => sum + stake.amount, 0);

  // legacy ?side=YES|NO deep links map to sortOrder 0/1
  const sideOutcomeId =
    side === "YES" ? market.outcomes[0]?.id : side === "NO" ? market.outcomes[1]?.id : undefined;
  const initialOutcomeId =
    market.outcomes.find((candidate) => candidate.id === outcomeParam)?.id ?? sideOutcomeId;

  const headline = classic ? market.outcomes[0] : market.leader;
  const openingProbability = market.oddsHistory[0]?.probs[headline.sortOrder] ?? 0;
  const delta = Math.round((headline.probability - openingProbability) * 100);

  const viewerSettled =
    market.positions.find((position) => position.userId === session.user.id) ?? null;

  // for the comment composer's avatar + optimistic rows
  const viewerCosmetics = await getUserCosmetics(session.user.id);

  // league operators manage the market inline (there is no /admin for
  // custom leagues); settlement previews only exist once there are stakes
  const resolvable =
    canOperate && (market.status === MarketStatus.OPEN || market.status === MarketStatus.CLOSED);
  let previews: SettlementPreview[] = [];
  if (resolvable) {
    previews = await Promise.all(
      market.outcomes.map(async (outcome) => {
        const preview = await previewSettlement(market.id, outcome.id);
        return { outcomeId: outcome.id, ...preview };
      }),
    );
  }

  // operators get a full-width Manage tab (deep-linkable as ?tab=manage)
  // rather than a card in the narrow sidebar
  const managePanel = canOperate ? (
    <div className="max-w-2xl space-y-4 rounded-xl border border-warn/40 bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warn">
        <Shield className="size-3.5" aria-hidden /> Market management
      </p>
      {market.status === MarketStatus.PROPOSED ? <ProposalReview marketId={market.id} /> : null}
      {market.status === MarketStatus.DRAFT ? (
        <form action={marketStatusAction}>
          <input type="hidden" name="marketId" value={market.id} />
          <input type="hidden" name="action" value="open" />
          <Button type="submit" variant="yes" size="sm">
            Open for betting
          </Button>
        </form>
      ) : null}
      {market.status === MarketStatus.OPEN ? (
        <CloseMarketForm marketId={market.id} size="sm" />
      ) : null}
      {resolvable ? (
        <ResolveMarketForm
          marketId={market.id}
          effectiveCloseAt={market.effectiveCloseAt}
          resolutionSource={market.resolutionSource}
          outcomes={market.outcomes.map((outcome) => ({
            id: outcome.id,
            label: outcome.label,
            color: outcome.color,
            emoji: outcome.emoji,
            pool: outcome.pool,
          }))}
          previews={previews}
        />
      ) : null}
      {isMarketEditable(market) ? (
        <details className="rounded-xl border border-border bg-surface-2">
          <summary className="cursor-pointer p-3 text-sm font-semibold text-muted">
            Edit market
          </summary>
          <div className="border-t border-border p-3">
            <MarketForm
              action={updateMarketAction}
              // custom-league markets inherit the league's economy settings,
              // so propose mode hides the rake/stake fields there
              mode={market.league.isGlobal ? "admin" : "propose"}
              categoryOptions={
                market.league.isGlobal
                  ? globalCategoryOptions()
                  : leagueCategoryOptions(market.league.categories)
              }
              market={{
                id: market.id,
                title: market.title,
                description: market.description,
                category: market.category,
                closeTime: market.closeTime,
                resolveTime: market.resolveTime,
                resolutionSource: market.resolutionSource,
                outcomes: market.outcomes.map((outcome) => ({
                  label: outcome.label,
                  color: outcome.color,
                  emoji: outcome.emoji,
                })),
                maxStakePerUser: market.maxStakePerUser,
                rakeBps: market.rakeBps,
              }}
            />
          </div>
        </details>
      ) : null}
    </div>
  ) : null;

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
        voidAmount={market.viewerVoidAmount}
      />
    ) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {!market.league.isGlobal ? (
              <Link
                href={`/l/${market.league.slug}` as Route}
                className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
              >
                {market.league.name}
              </Link>
            ) : null}
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
              {categoryDisplay(market.category)}
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
            <span>Closes <LocalTime date={market.closeTime} /></span>
            <span>Resolves <LocalTime date={market.resolveTime} /></span>
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
            {classic ? (
              <ProbabilityChip probability={headline.probability} size="xl" showLabel />
            ) : market.leaderTied ? (
              <ProbabilityChip probability={headline.probability} neutral label="even" size="xl" showLabel />
            ) : (
              <ProbabilityChip
                probability={headline.probability}
                color={headline.color}
                label={outcomeDisplayLabel(headline)}
                size="xl"
                showLabel
              />
            )}
            {market.betCount > 0 && delta !== 0 && (classic || !market.leaderTied) ? (
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
            ...(canOperate ? [{ id: "manage", label: "Manage" }] : []),
          ]}
          panels={{
            ...(canOperate ? { manage: managePanel } : {}),
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
                viewerUsername={session.user.username}
                viewerCosmetics={viewerCosmetics}
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
                    <dd className="mt-1"><LocalTime date={market.closeTime} /></dd>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-3">
                    <dt className="text-xs font-medium text-faint">Resolves by</dt>
                    <dd className="mt-1"><LocalTime date={market.resolveTime} /></dd>
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
                  : (
                      <>
                        Resolves <LocalTime date={market.resolveTime} />.
                      </>
                    )}
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
