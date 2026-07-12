import { LedgerEntryType, MarketStatus, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listUserItems } from "@/lib/server/item-service";
import { ensureGlobalLeague } from "@/lib/server/league-service";

const RECENT_RESULTS_LIMIT = 8;

/**
 * Everything the public profile page shows. Computed from the ledger on
 * request, like the leaderboard — no denormalized stats until it's slow.
 * Returns null for unknown handles and non-ACTIVE accounts (pending/rejected
 * applicants have no profile to show).
 */
export async function getProfileByUsername(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      name: true,
      username: true,
      bio: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    return null;
  }

  const [stats, trophyCase, recentResults] = await Promise.all([
    getCareerStats(user.id),
    listUserItems(user.id),
    getRecentResults(user.id),
  ]);

  return { ...user, stats, trophyCase, recentResults };
}

/**
 * Career (all-time) numbers, Global League only — the shared economy every
 * member plays in. Custom-league performance shows up on league pages and as
 * trophies, not here; mixing fresh-stack P&L into these totals would distort
 * them (different grants, different stakes). Same portfolio math as the
 * leaderboard: net profit = balance + at-risk stakes − grants. "Won" means
 * the market paid out (MARKET_PAYOUT only ever goes to winners; refunds are
 * a separate type), "played" counts resolved markets the user had a stake
 * in — canceled markets are refunded and don't count either way.
 */
async function getCareerStats(userId: string) {
  const league = await ensureGlobalLeague();
  const [ledgerSums, openStakes, biggestPayout, wonMarkets, resolvedMarkets] = await Promise.all([
    prisma.ledgerEntry.groupBy({
      by: ["type"],
      where: { userId, leagueId: league.id },
      _sum: { amount: true },
    }),
    prisma.poolStake.aggregate({
      where: {
        userId,
        market: { status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] }, leagueId: league.id },
      },
      _sum: { amount: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { userId, leagueId: league.id, type: LedgerEntryType.MARKET_PAYOUT },
      _max: { amount: true },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        userId,
        leagueId: league.id,
        type: LedgerEntryType.MARKET_PAYOUT,
        marketId: { not: null },
      },
      select: { marketId: true },
      distinct: ["marketId"],
    }),
    prisma.poolStake.findMany({
      where: { userId, market: { status: MarketStatus.RESOLVED, leagueId: league.id } },
      select: { marketId: true },
      distinct: ["marketId"],
    }),
  ]);

  const sumOf = (type: LedgerEntryType) =>
    ledgerSums.find((row) => row.type === type)?._sum.amount ?? 0;

  const balance = ledgerSums.reduce((total, row) => total + (row._sum.amount ?? 0), 0);
  const atRisk = openStakes._sum.amount ?? 0;
  const granted = sumOf(LedgerEntryType.INITIAL_GRANT) + sumOf(LedgerEntryType.WEEKLY_ALLOWANCE);

  const marketsPlayed = resolvedMarkets.length;
  const marketsWon = wonMarkets.length;

  return {
    netProfit: balance + atRisk - granted,
    portfolioValue: balance + atRisk,
    marketsPlayed,
    marketsWon,
    winRate: marketsPlayed > 0 ? marketsWon / marketsPlayed : null,
    biggestPayout: biggestPayout._max.amount ?? 0,
  };
}

/**
 * The user's last few settled markets with their per-market net
 * (payouts + refunds − stakes), newest settlement first.
 */
async function getRecentResults(userId: string) {
  const league = await ensureGlobalLeague();
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      userId,
      leagueId: league.id,
      marketId: { not: null },
      type: {
        in: [
          LedgerEntryType.BET_PLACED,
          LedgerEntryType.MARKET_PAYOUT,
          LedgerEntryType.MARKET_REFUND,
        ],
      },
      market: { status: { in: [MarketStatus.RESOLVED, MarketStatus.CANCELED] } },
    },
    select: {
      amount: true,
      marketId: true,
      market: {
        select: {
          id: true,
          title: true,
          status: true,
          resolvedAt: true,
          canceledAt: true,
          winningOutcome: { select: { label: true, color: true, emoji: true } },
        },
      },
    },
  });

  const byMarket = new Map<
    string,
    { market: NonNullable<(typeof entries)[number]["market"]>; net: number }
  >();

  for (const entry of entries) {
    if (!entry.marketId || !entry.market) continue;
    const row = byMarket.get(entry.marketId) ?? { market: entry.market, net: 0 };
    row.net += entry.amount; // BET_PLACED entries are already negative
    byMarket.set(entry.marketId, row);
  }

  return [...byMarket.values()]
    .map((row) => ({
      ...row,
      settledAt: row.market.resolvedAt ?? row.market.canceledAt ?? null,
    }))
    .sort((a, b) => (b.settledAt?.getTime() ?? 0) - (a.settledAt?.getTime() ?? 0))
    .slice(0, RECENT_RESULTS_LIMIT);
}
