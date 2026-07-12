import { notFound } from "next/navigation";
import clsx from "clsx";
import { Crown, Trophy } from "lucide-react";
import { ProfileLink } from "@/components/members/profile-link";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalTime } from "@/components/ui/local-time";
import { formatSignedPoints } from "@/lib/format";
import {
  getActiveSeason,
  getLeagueForViewer,
  listLeagueMembers,
} from "@/lib/server/league-service";
import {
  getSeasonStandings,
  listFinalizedSeasons,
  type SeasonStandingRow,
} from "@/lib/server/season-service";
import { requireSession } from "@/lib/session";

function scoreTone(value: number) {
  return value > 0 ? "text-yes" : value < 0 ? "text-no" : "text-muted";
}

function parseStandings(value: unknown): SeasonStandingRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (row): row is SeasonStandingRow =>
      !!row &&
      typeof row === "object" &&
      typeof (row as SeasonStandingRow).userId === "string" &&
      typeof (row as SeasonStandingRow).score === "number" &&
      typeof (row as SeasonStandingRow).rank === "number",
  );
}

export default async function LeagueLeaderboardPage({
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

  const [season, members, finalized] = await Promise.all([
    getActiveSeason(league.id),
    listLeagueMembers(league.id),
    listFinalizedSeasons(league.id),
  ]);

  const standings = season ? await getSeasonStandings(season) : [];
  const participantIds = new Set(standings.map((row) => row.userId));
  const spectators = members.filter((membership) => !participantIds.has(membership.user.id));

  return (
    <div className="space-y-5">
      {season ? (
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">{season.name}</span> · ends{" "}
          <LocalTime date={season.endsAt} /> — every market settled this season counts. Fresh
          stacks next season.
        </p>
      ) : null}

      {!season || standings.length === 0 ? (
        <EmptyState
          icon={Crown}
          title={season ? "No markets settled yet" : "No season running"}
          description={
            season
              ? "The first resolution starts the race."
              : "Standings appear once a season is underway."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Player</th>
                <th className="px-4 py-2.5 text-right font-medium">Season P&amp;L</th>
                <th className="px-4 py-2.5 text-right font-medium">Won</th>
                <th className="px-4 py-2.5 text-right font-medium">Settled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {standings.map((entry, index) => (
                <tr
                  key={entry.userId}
                  className={clsx(
                    "transition-colors",
                    entry.userId === session.user.id ? "bg-primary/5" : "hover:bg-surface-2",
                  )}
                >
                  <td className="px-4 py-2.5 font-semibold tabular-nums text-muted">
                    {index > 0 && entry.rank === standings[index - 1].rank ? (
                      <span className="text-faint">= {entry.rank}</span>
                    ) : (
                      entry.rank
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ProfileLink username={entry.username} className="flex items-center gap-2 font-medium">
                      <Avatar name={entry.name} size="xs" />
                      {entry.name}
                      {entry.userId === session.user.id ? (
                        <span className="text-xs font-normal text-faint">(you)</span>
                      ) : null}
                    </ProfileLink>
                  </td>
                  <td className={clsx("px-4 py-2.5 text-right font-bold tabular-nums", scoreTone(entry.score))}>
                    {formatSignedPoints(entry.score)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{entry.marketsWon}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{entry.marketsSettled}</td>
                </tr>
              ))}
              {season
                ? spectators.map((membership) => (
                    <tr key={membership.id} className="text-muted">
                      <td className="px-4 py-2.5 font-semibold text-faint">—</td>
                      <td className="px-4 py-2.5">
                        <ProfileLink
                          username={membership.user.username}
                          className="flex items-center gap-2 font-medium"
                        >
                          <Avatar name={membership.user.name} size="xs" />
                          {membership.user.name}
                        </ProfileLink>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-faint" colSpan={3}>
                        No settled markets yet
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      )}

      {finalized.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
            <Trophy className="size-3.5" aria-hidden /> Past seasons
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {finalized.map((past) => {
              const champions = parseStandings(past.standings).filter((row) => row.rank === 1);
              return (
                <li key={past.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-muted">{past.name}</span>
                  {champions.length === 0 ? (
                    <span className="text-faint">no markets settled</span>
                  ) : (
                    champions.map((champion) => (
                      <span key={champion.userId} className="font-medium">
                        🏆{" "}
                        <ProfileLink username={champion.username} className="hover:underline">
                          {champion.name}
                        </ProfileLink>{" "}
                        <span className={clsx("tabular-nums", scoreTone(champion.score))}>
                          {formatSignedPoints(champion.score)}
                        </span>
                      </span>
                    ))
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
