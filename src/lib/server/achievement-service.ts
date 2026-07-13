import { GemLedgerEntryType, ItemKind, ItemSource, MarketStatus } from "@prisma/client";
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_KEY,
  SHOWCASE_LIMIT,
  evaluateAchievements,
  preBetImpliedProb,
  type AchievementDef,
  type AchievementKey,
  type ResolvedMarketFact,
} from "@/lib/achievements";
import { prisma } from "@/lib/prisma";
import { ensureGlobalLeague } from "@/lib/server/league-service";
import { grantItem } from "@/lib/server/item-service";

/**
 * The achievement badge Items, created on first evaluation — the exact
 * upsert-by-slug pattern of ensureSeasonTrophyItems. Badges are
 * achievement-only: storeCost stays null so the store can't sell them.
 */
export async function ensureAchievementItems() {
  const badged = ACHIEVEMENTS.filter((def) => def.badgeSlug);
  const items = await Promise.all(
    badged.map((def) =>
      prisma.item.upsert({
        where: { slug: def.badgeSlug! },
        update: {},
        create: {
          slug: def.badgeSlug!,
          name: def.badgeName!,
          description: def.description,
          kind: ItemKind.BADGE,
          style: def.badgeStyle,
          storeCost: null,
        },
      }),
    ),
  );
  return new Map(items.map((item) => [item.slug, item]));
}

/**
 * A user's Global League resolved-market history as evaluator facts, in one
 * indexed query per table (no per-market fan-out): every RESOLVED market the
 * user staked, whether they won it, and — for won markets — the lowest
 * pre-bet implied probability among their bets on the winning outcome.
 */
export async function getUserResolvedHistory(userId: string): Promise<ResolvedMarketFact[]> {
  const globalLeague = await ensureGlobalLeague();

  const stakes = await prisma.poolStake.findMany({
    where: {
      userId,
      market: { status: MarketStatus.RESOLVED, leagueId: globalLeague.id },
    },
    select: {
      outcomeId: true,
      marketId: true,
      market: { select: { resolvedAt: true, winningOutcomeId: true } },
    },
  });

  if (stakes.length === 0) {
    return [];
  }

  const byMarket = new Map<string, { resolvedAt: Date; winningOutcomeId: string | null; won: boolean }>();
  for (const stake of stakes) {
    const entry = byMarket.get(stake.marketId) ?? {
      // resolvedAt is set on every RESOLVED market; fall back defensively
      resolvedAt: stake.market.resolvedAt ?? new Date(0),
      winningOutcomeId: stake.market.winningOutcomeId,
      won: false,
    };
    if (stake.outcomeId === stake.market.winningOutcomeId) {
      entry.won = true;
    }
    byMarket.set(stake.marketId, entry);
  }

  const wonMarketIds = [...byMarket.entries()].filter(([, m]) => m.won).map(([id]) => id);

  // lowest pre-bet implied probability per won market, from the bet snapshots
  const minProbByMarket = new Map<string, number | null>();
  if (wonMarketIds.length > 0) {
    const bets = await prisma.bet.findMany({
      where: { userId, marketId: { in: wonMarketIds } },
      select: {
        marketId: true,
        outcomeId: true,
        amount: true,
        outcomePoolAfter: true,
        totalPoolAfter: true,
      },
    });
    for (const bet of bets) {
      const market = byMarket.get(bet.marketId);
      if (!market || bet.outcomeId !== market.winningOutcomeId) {
        continue;
      }
      const prob = preBetImpliedProb(bet);
      if (prob === null) {
        continue;
      }
      const current = minProbByMarket.get(bet.marketId);
      minProbByMarket.set(bet.marketId, current == null ? prob : Math.min(current, prob));
    }
  }

  return [...byMarket.entries()].map(([marketId, market]) => ({
    marketId,
    resolvedAt: market.resolvedAt,
    won: market.won,
    minWinningImpliedProb: minProbByMarket.get(marketId) ?? null,
  }));
}

/**
 * Evaluates a user's full history and grants whatever is missing. Idempotent:
 * the gem entry is keyed by [userId, achievementKey] and the badge by
 * grantKey, so re-runs (and the launch backfill) can never double-grant.
 * Returns the newly granted keys.
 */
export async function evaluateUserAchievements(userId: string): Promise<AchievementKey[]> {
  const history = await getUserResolvedHistory(userId);
  if (history.length === 0) {
    return [];
  }

  const earned = evaluateAchievements(history);
  if (earned.length === 0) {
    return [];
  }

  const existing = await prisma.gemLedgerEntry.findMany({
    where: { userId, type: GemLedgerEntryType.ACHIEVEMENT },
    select: { achievementKey: true },
  });
  const existingKeys = new Set(existing.map((entry) => entry.achievementKey));
  const missing = earned.filter((key) => !existingKeys.has(key));

  const granted: AchievementKey[] = [];
  let badgeItems: Map<string, { id: string }> | null = null;

  for (const key of missing) {
    const def = ACHIEVEMENTS_BY_KEY.get(key)!;

    try {
      await prisma.gemLedgerEntry.create({
        data: {
          userId,
          type: GemLedgerEntryType.ACHIEVEMENT,
          amount: def.gems,
          achievementKey: key,
          description: `Achievement — ${def.name}`,
        },
      });
    } catch (error) {
      const isUniqueViolation =
        error && typeof error === "object" && "code" in error && error.code === "P2002";
      if (isUniqueViolation) {
        continue; // a concurrent evaluation granted it first
      }
      throw error;
    }

    if (def.badgeSlug) {
      badgeItems ??= await ensureAchievementItems();
      await grantItem({
        userId,
        itemId: badgeItems.get(def.badgeSlug)!.id,
        source: ItemSource.ACHIEVEMENT,
        provenance: { achievement: key },
        grantKey: `achievement:${key}:user:${userId}`,
      });
    }

    granted.push(key);
  }

  return granted;
}

export type AchievementProgress = {
  def: AchievementDef;
  earned: { at: Date; gems: number } | null;
  showcased: boolean;
};

/**
 * Every achievement definition with the user's earned state and showcase
 * flags — the /u/[username]/achievements page and the profile highlight
 * section both read this.
 */
export async function getAchievementProgress(userId: string): Promise<AchievementProgress[]> {
  const [entries, user] = await Promise.all([
    prisma.gemLedgerEntry.findMany({
      where: { userId, type: GemLedgerEntryType.ACHIEVEMENT },
      select: { achievementKey: true, amount: true, createdAt: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { showcasedAchievements: true },
    }),
  ]);

  const earnedByKey = new Map(entries.map((entry) => [entry.achievementKey, entry]));
  const showcased = new Set(user.showcasedAchievements);

  return ACHIEVEMENTS.map((def) => {
    const entry = earnedByKey.get(def.key);
    return {
      def,
      earned: entry ? { at: entry.createdAt, gems: entry.amount } : null,
      showcased: showcased.has(def.key),
    };
  });
}

/**
 * The achievements highlighted on a profile: the member's picks, falling back
 * to the most recently earned so fresh profiles aren't empty. Capped at
 * SHOWCASE_LIMIT either way.
 */
export async function getShowcasedAchievements(userId: string): Promise<AchievementProgress[]> {
  const progress = await getAchievementProgress(userId);
  const earned = progress.filter((row) => row.earned);
  const picked = earned.filter((row) => row.showcased);
  if (picked.length > 0) {
    return picked.slice(0, SHOWCASE_LIMIT);
  }
  return [...earned]
    .sort((a, b) => b.earned!.at.getTime() - a.earned!.at.getTime())
    .slice(0, SHOWCASE_LIMIT);
}

/** Replaces the showcase picks — earned achievements only, capped. */
export async function setShowcasedAchievements(userId: string, keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.length > SHOWCASE_LIMIT) {
    throw new Error(`Highlight up to ${SHOWCASE_LIMIT} achievements.`);
  }
  if (unique.some((key) => !ACHIEVEMENTS_BY_KEY.has(key as AchievementKey))) {
    throw new Error("Unknown achievement.");
  }

  const earned = await prisma.gemLedgerEntry.findMany({
    where: { userId, type: GemLedgerEntryType.ACHIEVEMENT, achievementKey: { in: unique } },
    select: { achievementKey: true },
  });
  if (earned.length !== unique.length) {
    throw new Error("You can only highlight achievements you've earned.");
  }

  return prisma.user.update({
    where: { id: userId },
    data: { showcasedAchievements: unique },
  });
}

/**
 * Runs the checker for every staker of a settled market — losers too, since
 * volume milestones advance regardless of outcome. No-ops unless the market
 * is a RESOLVED Global League market.
 */
export async function evaluateAchievementsForMarket(marketId: string) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { status: true, league: { select: { isGlobal: true } } },
  });
  if (!market || market.status !== MarketStatus.RESOLVED || !market.league.isGlobal) {
    return;
  }

  const stakers = await prisma.poolStake.findMany({
    where: { marketId },
    select: { userId: true },
    distinct: ["userId"],
  });

  for (const { userId } of stakers) {
    await evaluateUserAchievements(userId);
  }
}

/**
 * Daily catch-up sweep (cron): re-evaluates every market resolved in the last
 * `hours`, closing the crash window between a settlement commit and its
 * post-commit achievement pass. Cheap and idempotent.
 */
export async function evaluateAchievementsForRecentMarkets(hours = 48, now = new Date()) {
  const globalLeague = await ensureGlobalLeague();
  const markets = await prisma.market.findMany({
    where: {
      leagueId: globalLeague.id,
      status: MarketStatus.RESOLVED,
      resolvedAt: { gte: new Date(now.getTime() - hours * 60 * 60 * 1000) },
    },
    select: { id: true },
  });

  for (const market of markets) {
    await evaluateAchievementsForMarket(market.id);
  }

  return markets.length;
}
