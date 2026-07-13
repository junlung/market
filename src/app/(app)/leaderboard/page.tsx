import clsx from "clsx";
import { Crown, Trophy } from "lucide-react";
import { BadgeGlyph, TitleLine } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProfileLink } from "@/components/members/profile-link";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalTime } from "@/components/ui/local-time";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { NO_COSMETICS, type EquippedCosmetics } from "@/lib/cosmetics";
import { formatPoints, formatSignedPoints } from "@/lib/format";
import { getEquippedCosmetics } from "@/lib/server/item-service";
import { getLeaderboard } from "@/lib/server/market-service";
import {
  getGlobalSeasonLeaderboard,
  listFinalizedSeasons,
  type SeasonStandingRow,
} from "@/lib/server/season-service";
import { requireSession } from "@/lib/session";

const MEDALS = ["🥇", "🥈", "🥉"];

function scoreTone(value: number) {
  return value > 0 ? "text-yes" : value < 0 ? "text-no" : "text-muted";
}

type CosmeticsMap = Map<string, EquippedCosmetics>;

function cosmeticsFor(map: CosmeticsMap, userId: string) {
  return map.get(userId) ?? NO_COSMETICS;
}

function Podium({
  entries,
  viewerId,
  cosmetics,
  score,
  subline,
}: {
  entries: Array<{ userId: string; name: string; username: string; rank: number }>;
  viewerId: string;
  cosmetics: CosmeticsMap;
  score: (entry: { userId: string }) => number;
  subline: (entry: { userId: string; rank: number }) => React.ReactNode;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {entries.map((entry, index) => {
        const look = cosmeticsFor(cosmetics, entry.userId);
        return (
          <div
            key={entry.userId}
            className={clsx(
              "flex flex-col items-center rounded-xl border bg-surface p-5 text-center",
              index === 0 ? "border-warn/40 sm:order-2 sm:-mt-2" : "border-border",
              index === 1 && "sm:order-1",
              index === 2 && "sm:order-3",
            )}
          >
            <span className="text-2xl">{MEDALS[entry.rank - 1] ?? MEDALS[index]}</span>
            <ProfileLink username={entry.username} className="flex flex-col items-center">
              <MemberAvatar name={entry.name} size="lg" frame={look.frame} className="mt-2" />
              <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                {entry.name}
                <BadgeGlyph badge={look.badge} label={`${entry.name}'s badge`} />
                {entry.userId === viewerId ? (
                  <span className="text-xs font-normal text-faint">(you)</span>
                ) : null}
              </p>
            </ProfileLink>
            <TitleLine title={look.title} />
            <p className={clsx("mt-1 text-xl font-bold tabular-nums", scoreTone(score(entry)))}>
              {formatSignedPoints(score(entry))}
            </p>
            <p className="mt-0.5 text-xs text-muted tabular-nums">{subline(entry)}</p>
          </div>
        );
      })}
    </div>
  );
}

function SeasonBoard({
  seasonName,
  seasonEndsAt,
  standings,
  spectators,
  viewerId,
  cosmetics,
  pastSeasons,
}: {
  seasonName: string;
  seasonEndsAt: Date;
  standings: SeasonStandingRow[];
  spectators: Array<{ userId: string; name: string; username: string }>;
  viewerId: string;
  cosmetics: CosmeticsMap;
  pastSeasons: Array<{ id: string; name: string; champions: SeasonStandingRow[] }>;
}) {
  const podium = standings.slice(0, 3);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        <span className="font-medium text-foreground">{seasonName}</span> · resets{" "}
        <LocalTime date={seasonEndsAt} mode="date" /> — every market settled this month counts,
        no matter when the bets went in.
      </p>

      {standings.length === 0 ? (
        <EmptyState
          icon={Crown}
          title="No markets settled yet this season"
          description="The first resolution of the month starts the race. Open positions don't count until they settle."
        />
      ) : (
        <>
          <Podium
            entries={podium}
            viewerId={viewerId}
            cosmetics={cosmetics}
            score={(entry) => standings.find((row) => row.userId === entry.userId)?.score ?? 0}
            subline={(entry) => {
              const row = standings.find((standing) => standing.userId === entry.userId)!;
              const tied = entry.rank === 1 && podium.filter((p) => p.rank === 1).length > 1;
              return `${row.marketsWon}W / ${row.marketsSettled} settled${tied ? " · tied" : ""}`;
            }}
          />

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
                      entry.userId === viewerId ? "bg-primary/5" : "hover:bg-surface-2",
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
                      <span className="flex items-center gap-2 font-medium">
                        <ProfileLink username={entry.username} className="flex items-center gap-2">
                          <MemberAvatar
                            name={entry.name}
                            size="xs"
                            frame={cosmeticsFor(cosmetics, entry.userId).frame}
                          />
                          {entry.name}
                        </ProfileLink>
                        <BadgeGlyph
                          badge={cosmeticsFor(cosmetics, entry.userId).badge}
                          label={`${entry.name}'s badge`}
                        />
                        {entry.userId === viewerId ? (
                          <span className="text-xs text-faint">(you)</span>
                        ) : null}
                      </span>
                    </td>
                    <td
                      className={clsx(
                        "px-4 py-2.5 text-right font-bold tabular-nums",
                        scoreTone(entry.score),
                      )}
                    >
                      {formatSignedPoints(entry.score)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{entry.marketsWon}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                      {entry.marketsSettled}
                    </td>
                  </tr>
                ))}
                {spectators.map((entry) => (
                  <tr
                    key={entry.userId}
                    className={clsx(
                      "transition-colors",
                      entry.userId === viewerId ? "bg-primary/5" : "hover:bg-surface-2",
                    )}
                  >
                    <td className="px-4 py-2.5 font-semibold tabular-nums text-faint">—</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2 font-medium">
                        <ProfileLink username={entry.username} className="flex items-center gap-2">
                          <MemberAvatar
                            name={entry.name}
                            size="xs"
                            frame={cosmeticsFor(cosmetics, entry.userId).frame}
                          />
                          {entry.name}
                        </ProfileLink>
                        <BadgeGlyph
                          badge={cosmeticsFor(cosmetics, entry.userId).badge}
                          label={`${entry.name}'s badge`}
                        />
                        {entry.userId === viewerId ? (
                          <span className="text-xs text-faint">(you)</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-faint" colSpan={3}>
                      No settled markets yet
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pastSeasons.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
            <Trophy className="size-3.5" aria-hidden /> Past seasons
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {pastSeasons.map((season) => (
              <li key={season.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-muted">{season.name}</span>
                {season.champions.length === 0 ? (
                  <span className="text-faint">no markets settled</span>
                ) : (
                  season.champions.map((champion) => (
                    <span key={champion.userId} className="font-medium">
                      🏆{" "}
                      <ProfileLink username={champion.username} className="hover:underline">
                        {champion.name}
                      </ProfileLink>{" "}
                      <BadgeGlyph
                        badge={cosmeticsFor(cosmetics, champion.userId).badge}
                        label={`${champion.name}'s badge`}
                      />{" "}
                      <span className={clsx("tabular-nums", scoreTone(champion.score))}>
                        {formatSignedPoints(champion.score)}
                      </span>
                    </span>
                  ))
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-faint">
        Season rank is <span className="font-medium text-muted">realized profit</span> — payouts
        minus stakes on markets <em>resolved</em> this month. The board wipes monthly; balances and
        open markets carry over. Top three when the month closes take home trophies.
      </p>
    </div>
  );
}

function AllTimeBoard({
  ranked,
  viewerId,
  cosmetics,
}: {
  ranked: Array<
    Awaited<ReturnType<typeof getLeaderboard>>[number] & { rank: number }
  >;
  viewerId: string;
  cosmetics: CosmeticsMap;
}) {
  const podium = ranked.slice(0, 3);

  return (
    <div className="space-y-5">
      <Podium
        entries={podium}
        viewerId={viewerId}
        cosmetics={cosmetics}
        score={(entry) => ranked.find((row) => row.userId === entry.userId)?.netProfit ?? 0}
        subline={(entry) => {
          const row = ranked.find((r) => r.userId === entry.userId)!;
          const tied = entry.rank === 1 && podium.filter((p) => p.rank === 1).length > 1;
          return `${formatPoints(row.portfolioValue)} pts total${tied ? " · tied" : ""}`;
        }}
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Player</th>
              <th className="px-4 py-2.5 text-right font-medium">Net profit</th>
              <th className="px-4 py-2.5 text-right font-medium">Balance</th>
              <th className="px-4 py-2.5 text-right font-medium">At stake</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ranked.map((entry, index) => (
              <tr
                key={entry.userId}
                className={clsx(
                  "transition-colors",
                  entry.userId === viewerId ? "bg-primary/5" : "hover:bg-surface-2",
                )}
              >
                <td className="px-4 py-2.5 font-semibold tabular-nums text-muted">
                  {index > 0 && entry.rank === ranked[index - 1].rank ? (
                    <span className="text-faint">= {entry.rank}</span>
                  ) : (
                    entry.rank
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2 font-medium">
                    <ProfileLink username={entry.username} className="flex items-center gap-2">
                      <MemberAvatar
                        name={entry.name}
                        size="xs"
                        frame={cosmeticsFor(cosmetics, entry.userId).frame}
                      />
                      {entry.name}
                    </ProfileLink>
                    <BadgeGlyph
                      badge={cosmeticsFor(cosmetics, entry.userId).badge}
                      label={`${entry.name}'s badge`}
                    />
                    {entry.userId === viewerId ? (
                      <span className="text-xs text-faint">(you)</span>
                    ) : null}
                  </span>
                </td>
                <td
                  className={clsx(
                    "px-4 py-2.5 text-right font-bold tabular-nums",
                    scoreTone(entry.netProfit),
                  )}
                >
                  {formatSignedPoints(entry.netProfit)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatPoints(entry.balance)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                  {formatPoints(entry.atRisk)}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {formatPoints(entry.portfolioValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-faint">
        All-time rank is <span className="font-medium text-muted">net profit</span> — points won
        beyond what the house handed you (starting grant + weekly allowances). A bigger balance
        doesn&apos;t buy a better rank; winning bets does. Equal profit means a shared rank.
      </p>
    </div>
  );
}

/** The frozen standings Json from a finalized season, defensively parsed. */
function parseStandings(value: unknown): SeasonStandingRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (row): row is SeasonStandingRow =>
      !!row &&
      typeof row === "object" &&
      typeof (row as SeasonStandingRow).userId === "string" &&
      typeof (row as SeasonStandingRow).username === "string" &&
      typeof (row as SeasonStandingRow).score === "number" &&
      typeof (row as SeasonStandingRow).rank === "number",
  );
}

export default async function LeaderboardPage() {
  const session = await requireSession();
  const [{ league, season, standings }, allTime] = await Promise.all([
    getGlobalSeasonLeaderboard(),
    getLeaderboard(),
  ]);
  const finalizedSeasons = await listFinalizedSeasons(league.id, 6);

  // competition ranking: equal net profit = equal rank (1, 1, 3, ...)
  let lastProfit = Number.NaN;
  let lastRank = 0;
  const rankedAllTime = allTime.map((row, index) => {
    const rank = row.netProfit === lastProfit ? lastRank : index + 1;
    lastProfit = row.netProfit;
    lastRank = rank;
    return { ...row, rank };
  });

  const participantIds = new Set(standings.map((row) => row.userId));
  const spectators = allTime
    .filter((row) => !participantIds.has(row.userId))
    .map((row) => ({ userId: row.userId, name: row.name, username: row.username }));

  const pastSeasons = finalizedSeasons.map((finalized) => ({
    id: finalized.id,
    name: finalized.name,
    champions: parseStandings(finalized.standings).filter((row) => row.rank === 1),
  }));

  // one page-level cosmetics batch over every identity this page renders —
  // frozen standings hold no styles, so champions are always fetched live
  const cosmetics = await getEquippedCosmetics([
    ...standings.map((row) => row.userId),
    ...allTime.map((row) => row.userId),
    ...pastSeasons.flatMap((past) => past.champions.map((row) => row.userId)),
  ]);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Leaderboard"
        description={`${league.name} — the board resets every month; trophies are forever.`}
      />

      {allTime.length === 0 ? (
        <EmptyState icon={Crown} title="Nobody's here yet" description="Invite the group and let the games begin." />
      ) : (
        <Tabs
          param="view"
          tabs={[
            { id: "season", label: season.name },
            { id: "all-time", label: "All-time" },
          ]}
          panels={{
            season: (
              <SeasonBoard
                seasonName={season.name}
                seasonEndsAt={season.endsAt}
                standings={standings}
                spectators={spectators}
                viewerId={session.user.id}
                cosmetics={cosmetics}
                pastSeasons={pastSeasons}
              />
            ),
            "all-time": (
              <AllTimeBoard ranked={rankedAllTime} viewerId={session.user.id} cosmetics={cosmetics} />
            ),
          }}
        />
      )}
    </section>
  );
}
