import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, Coins, Flame, Plus, Trophy } from "lucide-react";
import { SeasonForm } from "@/components/leagues/season-form";
import { ProfileLink } from "@/components/members/profile-link";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalTime } from "@/components/ui/local-time";
import { StatCard } from "@/components/ui/stat-card";
import { formatPoints, formatSignedPoints } from "@/lib/format";
import {
  canOperateLeague,
  getActiveSeason,
  getLeagueBalance,
  getLeagueForViewer,
  getUpcomingSeason,
  listLeagueMembers,
} from "@/lib/server/league-service";
import { getActivityFeed } from "@/lib/server/market-service";
import { getSeasonStandings } from "@/lib/server/season-service";
import { requireSession } from "@/lib/session";

export default async function LeagueOverviewPage({
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

  const [canManage, season, upcoming, members, feed] = await Promise.all([
    canOperateLeague(league.id, session.user.id),
    getActiveSeason(league.id),
    getUpcomingSeason(league.id),
    listLeagueMembers(league.id),
    getActivityFeed(15, league.id),
  ]);

  const balance = await getLeagueBalance(session.user.id, {
    leagueId: league.id,
    balancePolicy: league.balancePolicy,
    seasonId: season?.id ?? null,
  });

  const standings = season ? await getSeasonStandings(season) : [];
  const viewerRow = standings.find((row) => row.userId === session.user.id);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label={season ? `Your stack — ${season.name}` : "Your stack"}
            value={`${formatPoints(balance)} pts`}
            hint={season ? undefined : "Dealt when a season starts"}
          />
          <StatCard
            label="Season P&L"
            value={viewerRow ? formatSignedPoints(viewerRow.score) : "—"}
            tone={viewerRow && viewerRow.score > 0 ? "yes" : viewerRow && viewerRow.score < 0 ? "no" : "default"}
            hint={viewerRow ? `rank #${viewerRow.rank}` : "No settled markets yet"}
          />
          <StatCard
            label="Season"
            value={season ? season.name : upcoming ? upcoming.name : "None"}
            hint={
              season ? (
                <>
                  ends <LocalTime date={season.endsAt} mode="date" />
                </>
              ) : upcoming ? (
                <>
                  starts <LocalTime date={upcoming.startsAt} mode="date" />
                </>
              ) : canManage ? (
                "Start one below"
              ) : (
                "Waiting on the owner"
              )
            }
          />
        </div>

        {!season && !upcoming ? (
          canManage ? (
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <CalendarClock className="size-4 text-primary" aria-hidden /> Start a season
              </p>
              <div className="mt-3">
                <SeasonForm leagueId={league.id} slug={slug} />
              </div>
            </div>
          ) : (
            <EmptyState
              icon={CalendarClock}
              title="No season running"
              description="The owner hasn't started a season yet — stacks are dealt when one begins."
            />
          )
        ) : null}

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Latest action</h2>
          <Link href={`/l/${slug}/markets/new` as Route} className={buttonClasses("primary", "sm")}>
            <Plus className="size-4" aria-hidden /> {canManage ? "New market" : "Propose a market"}
          </Link>
        </div>

        {feed.length === 0 ? (
          <EmptyState
            icon={Flame}
            title="All quiet"
            description="No bets yet. Open a market and get the group in."
          />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {feed.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <ProfileLink username={item.userUsername} className="flex shrink-0 items-center gap-2 font-medium">
                  <Avatar name={item.userName} size="xs" />
                  {item.userName}
                </ProfileLink>
                <span className="text-muted">
                  bet <span className="font-semibold text-foreground tabular-nums">{formatPoints(item.amount)}</span> on{" "}
                  <span className="font-medium text-foreground">{item.outcomeLabel}</span>
                </span>
                <Link
                  href={`/l/${slug}/markets/${item.marketId}` as Route}
                  className="min-w-0 flex-1 truncate text-right text-xs text-muted hover:text-foreground hover:underline"
                >
                  {item.marketTitle}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        {standings.length > 0 ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
              <Trophy className="size-3.5" aria-hidden /> {season?.name} standings
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {standings.slice(0, 5).map((row) => (
                <li key={row.userId} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-xs font-semibold text-muted tabular-nums">
                      {row.rank}
                    </span>
                    <ProfileLink username={row.username} className="truncate font-medium hover:underline">
                      {row.name}
                    </ProfileLink>
                  </span>
                  <span
                    className={
                      row.score > 0
                        ? "font-semibold text-yes tabular-nums"
                        : row.score < 0
                          ? "font-semibold text-no tabular-nums"
                          : "font-semibold text-muted tabular-nums"
                    }
                  >
                    {formatSignedPoints(row.score)}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href={`/l/${slug}/leaderboard` as Route}
              className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
            >
              Full leaderboard →
            </Link>
          </div>
        ) : null}

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
            <Coins className="size-3.5" aria-hidden /> Members
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {members.map((membership) => (
              <li key={membership.id} className="flex items-center justify-between gap-2">
                <ProfileLink
                  username={membership.user.username}
                  className="flex min-w-0 items-center gap-2 font-medium hover:underline"
                >
                  <Avatar name={membership.user.name} size="xs" />
                  <span className="truncate">{membership.user.name}</span>
                </ProfileLink>
                {membership.role !== "MEMBER" ? (
                  <span className="shrink-0 rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-medium text-warn">
                    {membership.role === "OWNER" ? "Owner" : "Mod"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
