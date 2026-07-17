/**
 * Achievement definitions and the pure evaluator (Phase 3). This is the single
 * gem-tuning file: every grant amount lives here as a named constant so the
 * economy can be retuned in one place.
 *
 * All achievements are Global-League-only (decision #1 — custom-league
 * activity never mints gems) and idempotent per (user, achievement) via the
 * GemLedgerEntry [userId, achievementKey] unique.
 */

import { GLOBAL_CATEGORIES, type EligibleCategorySlug } from "@/lib/categories";

/** Win-count tiers generated per achievement-eligible category. */
export const CATEGORY_WIN_TIERS = [
  { wins: 3, gems: 15, title: "Fan" },
  { wins: 10, gems: 50, title: "Buff" },
  { wins: 25, gems: 100, title: "Obsessive" },
  { wins: 50, gems: 200, title: "Oracle" },
  { wins: 100, gems: 400, title: "Savant" },
  { wins: 500, gems: 1500, title: "Demigod" },
] as const;

type CategoryTierWins = (typeof CATEGORY_WIN_TIERS)[number]["wins"];

/** Keys are permanent — the [userId, achievementKey] unique is the idempotency key. */
export type CategoryAchievementKey = `cat-${EligibleCategorySlug}-${CategoryTierWins}`;

export type AchievementKey =
  | "first-win"
  | "streak-3"
  | "streak-5"
  | "streak-10"
  | "longshot-win"
  | "volume-10"
  | "volume-50"
  | "volume-100"
  | CategoryAchievementKey;

export type AchievementDef = {
  key: AchievementKey;
  name: string;
  description: string;
  /** display glyph for achievement cards/lists (distinct from the badge item) */
  emoji: string;
  gems: number;
  /** when set, the achievement also grants this badge Item (achievement-only, never purchasable) */
  badgeSlug?: string;
  badgeName?: string;
  badgeStyle?: { renderer: "emoji"; glyph: string };
};

/** Gems for season placements 1st/2nd/3rd, granted at finalization. */
export const SEASON_PLACEMENT_GEMS = [100, 50, 25] as const;

/** One-time gem starting allowance — at approval and in the launch backfill. */
export const GEM_STARTING_GRANT = 1000;

/** How many achievements a member can highlight on their profile. */
export const SHOWCASE_LIMIT = 3;

/** A win qualifies as a longshot when the bet's pre-bet implied probability was below this. */
export const LONGSHOT_MAX_IMPLIED_PROB = 0.1;

/**
 * Six win-count tiers per eligible category, generated so a new category is a
 * one-line change in categories.ts. Wildcard generates nothing.
 */
const CATEGORY_ACHIEVEMENTS: readonly AchievementDef[] = GLOBAL_CATEGORIES.filter(
  (category) => category.achievementEligible,
).flatMap((category) =>
  CATEGORY_WIN_TIERS.map((tier) => ({
    key: `cat-${category.slug}-${tier.wins}` as CategoryAchievementKey,
    name: `${category.label} ${tier.title}`,
    description: `Win ${tier.wins} ${category.label} markets.`,
    emoji: category.emoji,
    gems: tier.gems,
  })),
);

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    key: "first-win",
    name: "First Blood",
    description: "Win your first market.",
    emoji: "🩸",
    gems: 10,
  },
  {
    key: "streak-3",
    name: "Warming Up",
    description: "Win 3 markets in a row.",
    emoji: "♨️",
    gems: 15,
  },
  {
    key: "streak-5",
    name: "Heater",
    description: "Win 5 markets in a row.",
    emoji: "🔥",
    gems: 30,
    badgeSlug: "badge-heater",
    badgeName: "Heater",
    badgeStyle: { renderer: "emoji", glyph: "🔥" },
  },
  {
    key: "streak-10",
    name: "Inferno",
    description: "Win 10 markets in a row.",
    emoji: "☄️",
    gems: 75,
    badgeSlug: "badge-inferno",
    badgeName: "Inferno",
    badgeStyle: { renderer: "emoji", glyph: "☄️" },
  },
  {
    key: "longshot-win",
    name: "Longshot",
    description: "Win a bet placed at under 10% implied odds.",
    emoji: "🎯",
    gems: 50,
    badgeSlug: "badge-longshot",
    badgeName: "Longshot",
    badgeStyle: { renderer: "emoji", glyph: "🎯" },
  },
  {
    key: "volume-10",
    name: "Regular",
    description: "See 10 of your markets settle.",
    emoji: "🎟️",
    gems: 20,
  },
  {
    key: "volume-50",
    name: "Fixture",
    description: "See 50 of your markets settle.",
    emoji: "🏟️",
    gems: 60,
  },
  {
    key: "volume-100",
    name: "Centurion",
    description: "See 100 of your markets settle.",
    emoji: "💯",
    gems: 150,
    badgeSlug: "badge-centurion",
    badgeName: "Centurion",
    badgeStyle: { renderer: "emoji", glyph: "💯" },
  },
  ...CATEGORY_ACHIEVEMENTS,
];

export const ACHIEVEMENTS_BY_KEY = new Map(ACHIEVEMENTS.map((def) => [def.key, def]));

const STREAK_KEYS: Array<{ key: AchievementKey; length: number }> = [
  { key: "streak-3", length: 3 },
  { key: "streak-5", length: 5 },
  { key: "streak-10", length: 10 },
];

const VOLUME_KEYS: Array<{ key: AchievementKey; count: number }> = [
  { key: "volume-10", count: 10 },
  { key: "volume-50", count: 50 },
  { key: "volume-100", count: 100 },
];

/**
 * One RESOLVED Global League market from the user's point of view. Canceled
 * markets are excluded upstream — they advance nothing (matches career-stats
 * semantics).
 */
export type ResolvedMarketFact = {
  marketId: string;
  resolvedAt: Date;
  won: boolean;
  /** the market's stored category value — canonical slugs count toward category tiers */
  category: string;
  /**
   * The lowest pre-bet implied probability among the user's bets on the
   * winning outcome; null when the user didn't win or the probability isn't
   * computable (e.g. the first bet into an empty market).
   */
  minWinningImpliedProb: number | null;
};

/**
 * Every achievement the history has earned. Pure — ordering is normalized
 * here (by resolution time, marketId tiebreak) so callers can pass rows in
 * any order. Streaks are runs of consecutive wins in resolution order.
 */
export function evaluateAchievements(history: ResolvedMarketFact[]): AchievementKey[] {
  const ordered = [...history].sort(
    (a, b) => a.resolvedAt.getTime() - b.resolvedAt.getTime() || a.marketId.localeCompare(b.marketId),
  );

  const earned: AchievementKey[] = [];

  if (ordered.some((fact) => fact.won)) {
    earned.push("first-win");
  }

  let bestStreak = 0;
  let run = 0;
  for (const fact of ordered) {
    run = fact.won ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }
  for (const { key, length } of STREAK_KEYS) {
    if (bestStreak >= length) {
      earned.push(key);
    }
  }

  if (
    ordered.some(
      (fact) =>
        fact.won &&
        fact.minWinningImpliedProb !== null &&
        fact.minWinningImpliedProb < LONGSHOT_MAX_IMPLIED_PROB,
    )
  ) {
    earned.push("longshot-win");
  }

  for (const { key, count } of VOLUME_KEYS) {
    if (ordered.length >= count) {
      earned.push(key);
    }
  }

  const winsByCategory = new Map<string, number>();
  for (const fact of ordered) {
    if (fact.won) {
      winsByCategory.set(fact.category, (winsByCategory.get(fact.category) ?? 0) + 1);
    }
  }
  for (const category of GLOBAL_CATEGORIES) {
    if (!category.achievementEligible) {
      continue;
    }
    const wins = winsByCategory.get(category.slug) ?? 0;
    for (const tier of CATEGORY_WIN_TIERS) {
      if (wins >= tier.wins) {
        earned.push(`cat-${category.slug}-${tier.wins}` as CategoryAchievementKey);
      }
    }
  }

  return earned;
}

/**
 * Pre-bet implied probability from the post-bet snapshots stored on a Bet.
 * Null when the outcome had no backing before this bet (division by zero —
 * a first bet into an empty pool has no meaningful implied odds).
 */
export function preBetImpliedProb(bet: {
  amount: number;
  outcomePoolAfter: number;
  totalPoolAfter: number;
}): number | null {
  const outcomeBefore = bet.outcomePoolAfter - bet.amount;
  const totalBefore = bet.totalPoolAfter - bet.amount;
  if (totalBefore <= 0 || outcomeBefore < 0) {
    return null;
  }
  if (outcomeBefore === 0) {
    // untouched outcome: implied prob was 0 — the ultimate longshot, but only
    // meaningful when someone else had already staked the market
    return 0;
  }
  return outcomeBefore / totalBefore;
}
