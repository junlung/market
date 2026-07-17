import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import { Shield, Trophy, Users } from "lucide-react";
import { marketStatusAction } from "@/app/actions/markets";
import { CloseMarketForm } from "@/components/markets/close-market-form";
import { CommentThread } from "@/components/markets/comment-thread";
import { GuessForm } from "@/components/markets/guess-form";
import { GuessResolveForm } from "@/components/markets/guess-resolve-form";
import { BadgeGlyph } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProfileLink } from "@/components/members/profile-link";
import { Button } from "@/components/ui/button";
import { CountdownBadge } from "@/components/ui/countdown-badge";
import { LocalTime } from "@/components/ui/local-time";
import { StatusBadge } from "@/components/ui/status-badge";
import { categoryDisplay } from "@/lib/categories";
import { formatPoints, formatSignedPoints } from "@/lib/format";
import { getMarketStatusLabel } from "@/lib/markets";
import { getUserCosmetics } from "@/lib/server/item-service";
import { canOperateLeague, getLeagueMembership } from "@/lib/server/league-service";
import { getGuessMarketDetail } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

const RANK_MEDALS = ["🥇", "🥈", "🥉"] as const;

/**
 * The closest-guess market page: a timeline of claimed dates instead of odds,
 * a claim/move form while open, ranked payouts once resolved. Same canonical
 * URL discipline and gates as the parimutuel view.
 */
export async function GuessMarketView({
  marketId,
  expectedLeagueSlug,
}: {
  marketId: string;
  expectedLeagueSlug?: string;
}) {
  const session = await requireSession();
  const market = await getGuessMarketDetail(marketId, session.user.id);

  if (!market || market.status === MarketStatus.REJECTED) {
    notFound();
  }
  if (!expectedLeagueSlug && !market.league.isGlobal) {
    redirect(`/l/${market.league.slug}/markets/${market.id}` as Route);
  }
  if (expectedLeagueSlug && market.league.slug !== expectedLeagueSlug) {
    notFound();
  }

  const canOperate = await canOperateLeague(market.league.id, session.user.id);
  if (!market.league.isGlobal) {
    const membership = await getLeagueMembership(market.league.id, session.user.id);
    if (!membership && !canOperate) {
      notFound();
    }
  }

  const isOpen = market.status === MarketStatus.OPEN && market.closeTime > new Date();
  const isCanceled = market.status === MarketStatus.CANCELED;
  const isResolved = market.status === MarketStatus.RESOLVED;
  const viewerCosmetics = await getUserCosmetics(session.user.id);

  // guess values live at UTC midnight — the calendar date is the identity
  const takenDates = market.guesses.map((guess) => guess.value.toISOString().slice(0, 10));
  const guessDateLabel = (value: Date) =>
    value.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const actual = market.resolution?.actualValue ?? null;
  const rankedGuesses = isResolved
    ? [...market.guesses].sort(
        (a, b) => (a.finalRank ?? Number.MAX_SAFE_INTEGER) - (b.finalRank ?? Number.MAX_SAFE_INTEGER),
      )
    : market.guesses;

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
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              Closest guess
            </span>
            <StatusBadge label={getMarketStatusLabel(market.status)} />
            {isOpen ? <CountdownBadge closeTime={market.closeTime} /> : null}
          </div>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{market.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">{market.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Trophy className="size-3.5 text-warn" aria-hidden />
              {formatPoints(market.pot)} pts pot ({formatPoints(market.anteAmount)} ante)
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="size-3.5" aria-hidden /> {market.guesses.length} in
            </span>
            <span>
              Closes <LocalTime date={market.closeTime} />
            </span>
          </div>
        </div>

        {isCanceled ? (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            Canceled — every ante was refunded.
          </p>
        ) : null}
        {isResolved && actual ? (
          <p className="rounded-xl border border-yes/40 bg-yes-bg p-4 text-sm">
            <span className="font-semibold">The answer: {guessDateLabel(actual)}.</span>{" "}
            Closest three split the pot 60/25/15.
          </p>
        ) : null}

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">
            {isResolved ? "Final board" : "Claimed dates"}
          </p>
          {market.guesses.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Nobody&apos;s in yet — the timeline is wide open.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {rankedGuesses.map((guess) => (
                <li key={guess.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <ProfileLink
                    username={guess.username}
                    className="flex min-w-0 items-center gap-2 font-medium hover:underline"
                  >
                    {isResolved && guess.finalRank && guess.finalRank <= 3 ? (
                      <span aria-hidden>{RANK_MEDALS[guess.finalRank - 1]}</span>
                    ) : null}
                    <MemberAvatar name={guess.name} size="xs" frame={guess.cosmetics?.frame} />
                    <span className="truncate">{guess.name}</span>
                    <BadgeGlyph badge={guess.cosmetics?.badge} label={`${guess.name}'s badge`} />
                  </ProfileLink>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums">
                    <span>{guessDateLabel(guess.value)}</span>
                    {isResolved ? (
                      <span
                        className={
                          (guess.payout ?? 0) - market.anteAmount >= 0
                            ? "text-xs font-semibold text-yes"
                            : "text-xs font-semibold text-no"
                        }
                      >
                        {formatSignedPoints((guess.payout ?? 0) - market.anteAmount)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <CommentThread
          marketId={market.id}
          comments={market.comments}
          viewerName={session.user.name ?? "You"}
          viewerUsername={session.user.username}
          viewerCosmetics={viewerCosmetics}
        />
      </div>

      <div className="space-y-4">
        {isOpen ? (
          <GuessForm
            marketId={market.id}
            ante={market.anteAmount}
            viewerGuess={market.viewerGuess}
            takenDates={takenDates}
          />
        ) : null}

        {canOperate ? (
          <div className="space-y-4 rounded-xl border border-warn/40 bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warn">
              <Shield className="size-3.5" aria-hidden /> Market management
            </p>
            {market.status === MarketStatus.DRAFT ? (
              <form action={marketStatusAction}>
                <input type="hidden" name="marketId" value={market.id} />
                <input type="hidden" name="action" value="open" />
                <Button type="submit" variant="yes" size="sm">
                  Open for guessing
                </Button>
              </form>
            ) : null}
            {market.status === MarketStatus.OPEN ? (
              <CloseMarketForm marketId={market.id} size="sm" />
            ) : null}
            {market.status === MarketStatus.OPEN || market.status === MarketStatus.CLOSED ? (
              <GuessResolveForm marketId={market.id} resolutionSource={market.resolutionSource} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
