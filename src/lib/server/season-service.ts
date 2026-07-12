import {
  AppLogEventType,
  AppLogLevel,
  ItemKind,
  ItemSource,
  LeagueRole,
  LedgerEntryType,
  MarketStatus,
  Prisma,
  SeasonStatus,
  UserStatus,
} from "@prisma/client";
import { getMonthSeasonName, getMonthWindow, rankByScore } from "@/lib/leagues";
import { prisma } from "@/lib/prisma";
import { grantItem } from "@/lib/server/item-service";
import {
  ensureGlobalLeague,
  grantSeasonStack,
  requireLeagueRole,
} from "@/lib/server/league-service";

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

type SeasonRef = { id: string; leagueId: string; startsAt: Date; endsAt: Date };

/**
 * Season standings. Two attribution modes, one aggregation:
 *
 * - Global League (decision #6): realized P&L attributed to the month the
 *   market RESOLVES — Σ(payout − your total stake) across markets resolved
 *   inside the window, whenever the bets went in.
 * - Custom (fresh-stack) leagues: attributed by the market's pinned season
 *   (market.seasonId) instead of the resolution timestamp, so a commissioner
 *   resolving the weekend's last market on Monday doesn't drop it from the
 *   standings. Amended 2026-07-12; finalization waits for unsettled markets.
 *
 * Open positions never move the rank; canceled markets are excluded (their
 * refunds net to zero anyway). Only participants (≥1 settled market) are
 * ranked — padding the board with unranked zeros is the page's choice.
 */
export async function getSeasonStandings(season: SeasonRef): Promise<SeasonStandingRow[]> {
  const league = await prisma.league.findUniqueOrThrow({
    where: { id: season.leagueId },
    select: { isGlobal: true },
  });

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
      market: league.isGlobal
        ? {
            status: MarketStatus.RESOLVED,
            resolvedAt: { gte: season.startsAt, lt: season.endsAt },
          }
        : { status: MarketStatus.RESOLVED, seasonId: season.id },
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

/** All of a league's seasons, newest first (settings page history). */
export async function listSeasons(leagueId: string, limit = 12) {
  return prisma.season.findMany({
    where: { leagueId },
    orderBy: { index: "desc" },
    take: limit,
  });
}

/** Whether any season has started — the league-settings lock condition. */
export async function hasStartedSeason(leagueId: string) {
  const started = await prisma.season.findFirst({
    where: { leagueId, startsAt: { lte: new Date() } },
    select: { id: true },
  });
  return started !== null;
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
// Custom-league seasons (2b): owner-set dates, manual roll
// ---------------------------------------------------------------------------

/**
 * Opens a custom league's next season. One season at a time: creation is
 * rejected while an ACTIVE or UPCOMING season exists — "start the next
 * season" is an explicit owner action, never an auto-roll (2b decision #5).
 * A season starting now activates immediately and grants every member their
 * fresh stack; a future start becomes UPCOMING and the daily cron activates
 * it (grants included) when its day comes.
 */
export async function createSeason(
  leagueId: string,
  actorId: string,
  input: { name?: string; startsAt: Date; endsAt: Date },
) {
  await requireLeagueRole(leagueId, actorId, [LeagueRole.OWNER, LeagueRole.MOD]);

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.isGlobal) {
    throw new Error("Global League seasons roll automatically.");
  }

  if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
    throw new Error("The season must end after it starts.");
  }
  if (input.endsAt.getTime() <= Date.now()) {
    throw new Error("The season can't already be over.");
  }

  const existing = await prisma.season.findFirst({
    where: { leagueId, status: { in: [SeasonStatus.ACTIVE, SeasonStatus.UPCOMING] } },
    select: { id: true, name: true, status: true },
  });
  if (existing) {
    throw new Error(`${existing.name} is still ${existing.status.toLowerCase()} — finish it first.`);
  }

  const lastIndex = await prisma.season.aggregate({ where: { leagueId }, _max: { index: true } });
  const index = (lastIndex._max.index ?? 0) + 1;
  const startsNow = input.startsAt.getTime() <= Date.now();

  const season = await prisma.season.create({
    data: {
      leagueId,
      index,
      name: input.name?.trim() || `Season ${index}`,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: startsNow ? SeasonStatus.ACTIVE : SeasonStatus.UPCOMING,
    },
  });

  if (startsNow) {
    await grantSeasonStacks(season.id);
  }

  return season;
}

/** Fresh stacks for every current member of the season's league. Idempotent. */
async function grantSeasonStacks(seasonId: string) {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: { league: { include: { memberships: { select: { userId: true } } } } },
  });

  for (const membership of season.league.memberships) {
    await grantSeasonStack(membership.userId, season.league, season);
  }
}

/**
 * Cron: flip UPCOMING seasons whose start date arrived to ACTIVE and grant
 * the stacks. Stacks go first — they're idempotent, so a crash between the
 * grants and the flip just re-runs; the flip is a guarded updateMany so two
 * runs can't both claim it.
 */
export async function activateDueSeasons(now = new Date()) {
  const due = await prisma.season.findMany({
    where: { status: SeasonStatus.UPCOMING, startsAt: { lte: now } },
    select: { id: true, name: true, leagueId: true },
  });

  for (const season of due) {
    await grantSeasonStacks(season.id);
    await prisma.season.updateMany({
      where: { id: season.id, status: SeasonStatus.UPCOMING },
      data: { status: SeasonStatus.ACTIVE },
    });
  }

  return due.length;
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
 *
 * Custom seasons additionally wait for their markets: while any OPEN/CLOSED
 * market is still pinned to the season, standings would be incomplete, so
 * the season stays ACTIVE until the commissioner settles them (amended
 * 2026-07-12). Global seasons never wait — their attribution is by
 * resolution month, so a late resolution simply counts next month.
 */
export async function finalizeDueSeasons(now = new Date()): Promise<FinalizedSeasonSummary[]> {
  const due = await prisma.season.findMany({
    where: { status: SeasonStatus.ACTIVE, endsAt: { lte: now } },
    include: { league: true },
    orderBy: { startsAt: "asc" },
  });

  const summaries: FinalizedSeasonSummary[] = [];
  for (const season of due) {
    if (!season.league.isGlobal) {
      const unsettled = await prisma.market.count({
        where: {
          seasonId: season.id,
          status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] },
        },
      });
      if (unsettled > 0) {
        continue; // waits for the commissioner; the next cron run retries
      }
    }

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
  // shouldn't depend on a member visiting it to exist. Custom leagues never
  // auto-roll; their UPCOMING seasons just activate when their day arrives.
  const global = await ensureGlobalLeague();
  await ensureCurrentSeason(global.id, now);
  await activateDueSeasons(now);

  return summaries;
}
