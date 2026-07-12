import {
  AppLogEventType,
  AppLogLevel,
  ItemKind,
  ItemSource,
  LedgerEntryType,
  MarketStatus,
  Prisma,
  SeasonStatus,
  UserStatus,
} from "@prisma/client";
import { getMonthSeasonName, getMonthWindow, rankByScore } from "@/lib/leagues";
import { prisma } from "@/lib/prisma";
import { grantItem } from "@/lib/server/item-service";
import { ensureGlobalLeague } from "@/lib/server/league-service";

/**
 * The season a member sees on the leaderboard: opens lazily on read, like the
 * weekly allowance — creating a season row has no side effects, so it doesn't
 * need to wait for the cron (which handles finalization, the part with side
 * effects). Race-safe via the unique [leagueId, startsAt].
 */
export async function ensureCurrentSeason(leagueId: string, now = new Date()) {
  const existing = await prisma.season.findFirst({
    where: { leagueId, startsAt: { lte: now }, endsAt: { gt: now } },
  });
  if (existing) {
    return existing;
  }

  const { startsAt, endsAt } = getMonthWindow(now);
  const lastIndex = await prisma.season.aggregate({
    where: { leagueId },
    _max: { index: true },
  });

  try {
    return await prisma.season.create({
      data: {
        leagueId,
        index: (lastIndex._max.index ?? 0) + 1,
        name: getMonthSeasonName(now),
        startsAt,
        endsAt,
        status: SeasonStatus.ACTIVE,
      },
    });
  } catch (error) {
    // unique-violation race on [leagueId, startsAt] or [leagueId, index] —
    // a concurrent request created this month's season; use theirs
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.season.findFirstOrThrow({
        where: { leagueId, startsAt: { lte: now }, endsAt: { gt: now } },
      });
    }
    throw error;
  }
}

export type SeasonStandingRow = {
  userId: string;
  name: string;
  username: string;
  /** Σ(payouts − stakes) over markets resolved inside the season window. */
  score: number;
  marketsSettled: number;
  marketsWon: number;
  rank: number;
};

type SeasonWindow = { leagueId: string; startsAt: Date; endsAt: Date };

/**
 * Season standings per decision #6: realized P&L attributed to the month the
 * market RESOLVES — your score is Σ(payout − your total stake on that market)
 * across markets resolved inside the window. Open positions never move the
 * rank; canceled markets are excluded (their refunds net to zero anyway).
 * Only participants (≥1 settled market in the window) are ranked — every
 * ACTIVE non-participant sits at 0 by definition, and padding the board with
 * unranked zeros is the page's presentation choice, not the standings'.
 */
export async function getSeasonStandings(season: SeasonWindow): Promise<SeasonStandingRow[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      leagueId: season.leagueId,
      type: {
        in: [
          LedgerEntryType.BET_PLACED,
          LedgerEntryType.MARKET_PAYOUT,
          LedgerEntryType.MARKET_REFUND,
        ],
      },
      market: {
        status: MarketStatus.RESOLVED,
        resolvedAt: { gte: season.startsAt, lt: season.endsAt },
      },
      user: { status: UserStatus.ACTIVE },
    },
    select: {
      userId: true,
      marketId: true,
      type: true,
      amount: true,
      user: { select: { name: true, username: true } },
    },
  });

  type Accumulator = {
    userId: string;
    name: string;
    username: string;
    score: number;
    settled: Set<string>;
    won: Set<string>;
  };
  const byUser = new Map<string, Accumulator>();

  for (const entry of entries) {
    const row = byUser.get(entry.userId) ?? {
      userId: entry.userId,
      name: entry.user.name,
      username: entry.user.username,
      score: 0,
      settled: new Set<string>(),
      won: new Set<string>(),
    };
    row.score += entry.amount; // BET_PLACED entries are already negative
    if (entry.marketId) {
      row.settled.add(entry.marketId);
      if (entry.type === LedgerEntryType.MARKET_PAYOUT) {
        row.won.add(entry.marketId);
      }
    }
    byUser.set(entry.userId, row);
  }

  return rankByScore(
    [...byUser.values()].map((row) => ({
      userId: row.userId,
      name: row.name,
      username: row.username,
      score: row.score,
      marketsSettled: row.settled.size,
      marketsWon: row.won.size,
    })),
  );
}

/** Current season + live standings for a league — the leaderboard page read. */
export async function getGlobalSeasonLeaderboard() {
  const league = await ensureGlobalLeague();
  const season = await ensureCurrentSeason(league.id);
  const standings = await getSeasonStandings(season);
  return { league, season, standings };
}

/** Finalized seasons, newest first, with their frozen standings. */
export async function listFinalizedSeasons(leagueId: string, limit = 12) {
  return prisma.season.findMany({
    where: { leagueId, status: SeasonStatus.FINALIZED },
    orderBy: { startsAt: "desc" },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Finalization (cron)
// ---------------------------------------------------------------------------

const SEASON_TROPHY_DEFS = [
  {
    slug: "season-champion",
    name: "Season Champion",
    description: "Finished 1st in a league season.",
    style: { emoji: "🏆" },
  },
  {
    slug: "season-runner-up",
    name: "Season Runner-Up",
    description: "Finished 2nd in a league season.",
    style: { emoji: "🥈" },
  },
  {
    slug: "season-third",
    name: "Season Third Place",
    description: "Finished 3rd in a league season.",
    style: { emoji: "🥉" },
  },
];

/** The three placement trophies, created on first finalization. */
async function ensureSeasonTrophyItems() {
  return Promise.all(
    SEASON_TROPHY_DEFS.map((def) =>
      prisma.item.upsert({
        where: { slug: def.slug },
        update: {},
        create: { ...def, kind: ItemKind.TROPHY, storeCost: null },
      }),
    ),
  );
}

export type FinalizedSeasonSummary = {
  seasonId: string;
  leagueSlug: string;
  seasonName: string;
  participants: number;
  trophiesGranted: number;
};

/**
 * Finalizes every ACTIVE season whose window has ended, then rolls the Global
 * League forward. Safe to run any day, any number of times:
 *
 * - trophies are granted BEFORE the status flip and are grantKey-idempotent,
 *   so a crash between the two just re-grants no-ops on the next run;
 * - the flip itself is `updateMany where status=ACTIVE`, so two concurrent
 *   runs can't both claim a season;
 * - season opening is unique-constrained per month.
 */
export async function finalizeDueSeasons(now = new Date()): Promise<FinalizedSeasonSummary[]> {
  const due = await prisma.season.findMany({
    where: { status: SeasonStatus.ACTIVE, endsAt: { lte: now } },
    include: { league: true },
    orderBy: { startsAt: "asc" },
  });

  const summaries: FinalizedSeasonSummary[] = [];
  for (const season of due) {
    const standings = await getSeasonStandings(season);
    const podium = standings.filter((row) => row.rank <= 3);

    if (podium.length > 0) {
      const trophies = await ensureSeasonTrophyItems();
      for (const row of podium) {
        await grantItem({
          userId: row.userId,
          itemId: trophies[row.rank - 1].id,
          source: ItemSource.SEASON_TROPHY,
          provenance: {
            league: season.league.name,
            leagueSlug: season.league.slug,
            seasonId: season.id,
            seasonName: season.name,
            placement: row.rank,
            score: row.score,
          },
          grantKey: `season:${season.id}:user:${row.userId}`,
        });
      }
    }

    const claimed = await prisma.season.updateMany({
      where: { id: season.id, status: SeasonStatus.ACTIVE },
      data: {
        status: SeasonStatus.FINALIZED,
        finalizedAt: now,
        standings: standings as unknown as Prisma.InputJsonValue,
      },
    });

    if (claimed.count === 0) {
      continue; // a concurrent run finalized it first
    }

    await prisma.appLog.create({
      data: {
        level: AppLogLevel.INFO,
        eventType: AppLogEventType.ADMIN_ACTION,
        message: `Finalized season ${season.name} (${season.league.name})`,
        metadata: {
          seasonId: season.id,
          participants: standings.length,
          trophiesGranted: podium.length,
        },
      },
    });

    summaries.push({
      seasonId: season.id,
      leagueSlug: season.league.slug,
      seasonName: season.name,
      participants: standings.length,
      trophiesGranted: podium.length,
    });
  }

  // roll the Global League into the new month even on quiet days — the board
  // shouldn't depend on a member visiting it to exist
  const global = await ensureGlobalLeague();
  await ensureCurrentSeason(global.id, now);

  return summaries;
}
