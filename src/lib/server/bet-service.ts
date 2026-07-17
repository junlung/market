import { AppLogEventType, AppLogLevel, LedgerEntryType, MarketStatus } from "@prisma/client";
import { sumLedgerAmounts } from "@/lib/ledger";
import { assertSafeInt } from "@/lib/parimutuel";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureLeagueAllowance, ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { balanceWhere } from "@/lib/server/league-service";
import { withSerializableRetry } from "@/lib/server/tx";

export type PlaceBetResult = {
  betId: string;
  pools: Array<{ outcomeId: string; pool: number }>;
  stakeTotal: number;
};

export async function placeBet(input: {
  userId: string;
  marketId: string;
  outcomeId: string;
  amount: number;
  skipRateLimit?: boolean;
}): Promise<PlaceBetResult> {
  enforceRateLimit(`bet:${input.userId}:${input.marketId}`, { skip: input.skipRateLimit });

  assertSafeInt(input.amount, "Bet amount");
  if (input.amount < 1) {
    throw new Error("Bet at least 1 point.");
  }

  // lazy allowances before the balance check: the global one always, the
  // market's league one when it has an allowance policy of its own
  const allowanceTarget = await prisma.market.findUnique({
    where: { id: input.marketId },
    select: { league: true },
  });
  await ensureWeeklyAllowance(input.userId);
  if (allowanceTarget && !allowanceTarget.league.isGlobal) {
    await ensureLeagueAllowance(input.userId, allowanceTarget.league);
  }

  return withSerializableRetry(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: input.marketId },
      include: {
        league: { select: { id: true, balancePolicy: true } },
        outcomes: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!market) {
      throw new Error("Market not found.");
    }

    // trust boundary: the outcome must belong to this market — a foreign
    // outcomeId would corrupt another market's pools
    const outcome = market.outcomes.find((candidate) => candidate.id === input.outcomeId);
    if (!outcome) {
      throw new Error("That outcome doesn't belong to this market.");
    }

    if (market.status !== MarketStatus.OPEN) {
      throw new Error("Betting is closed for this market.");
    }

    if (market.closeTime <= new Date()) {
      throw new Error("This market is past its close time.");
    }

    // custom-league markets are members-only — a non-member betting would
    // mint a stake from a stack they were never granted
    const membership = await tx.leagueMembership.findUnique({
      where: { leagueId_userId: { leagueId: market.leagueId, userId: input.userId } },
      select: { id: true },
    });
    if (!membership) {
      throw new Error("Only league members can bet on this market.");
    }

    // spendable balance is scoped to the market's league (and, for
    // fresh-stack leagues, its season) — Global points can't cross over
    const balanceEntries = await tx.ledgerEntry.findMany({
      where: balanceWhere(input.userId, {
        leagueId: market.leagueId,
        balancePolicy: market.league.balancePolicy,
        seasonId: market.seasonId,
      }),
      select: { amount: true },
    });
    const balance = sumLedgerAmounts(balanceEntries);

    if (input.amount > balance) {
      throw new Error("Insufficient balance.");
    }

    const existingStakes = await tx.poolStake.findMany({
      where: { userId: input.userId, marketId: input.marketId },
      select: { amount: true },
    });
    const exposure = existingStakes.reduce((sum, stake) => sum + stake.amount, 0);

    if (exposure + input.amount > market.maxStakePerUser) {
      const remaining = Math.max(market.maxStakePerUser - exposure, 0);
      throw new Error(
        remaining > 0
          ? `Stake cap is ${market.maxStakePerUser} points per player — you can add up to ${remaining} more.`
          : `You've hit this market's ${market.maxStakePerUser}-point stake cap.`,
      );
    }

    const outcomePoolAfter = outcome.pool + input.amount;
    const totalPoolAfter = market.outcomes.reduce((sum, o) => sum + o.pool, 0) + input.amount;
    assertSafeInt(outcomePoolAfter, "Outcome pool");
    assertSafeInt(totalPoolAfter, "Total pool");

    const bet = await tx.bet.create({
      data: {
        userId: input.userId,
        marketId: input.marketId,
        outcomeId: outcome.id,
        amount: input.amount,
        outcomePoolAfter,
        totalPoolAfter,
      },
    });

    await tx.poolStake.upsert({
      where: {
        userId_marketId_outcomeId: {
          userId: input.userId,
          marketId: input.marketId,
          outcomeId: outcome.id,
        },
      },
      update: {
        amount: { increment: input.amount },
      },
      create: {
        userId: input.userId,
        marketId: input.marketId,
        outcomeId: outcome.id,
        amount: input.amount,
      },
    });

    await tx.outcome.update({
      where: { id: outcome.id },
      data: { pool: outcomePoolAfter },
    });

    // the market-row write is the write-write fence between bets and
    // resolution now that pools live on Outcome rows
    await tx.market.update({
      where: { id: input.marketId },
      data: {
        firstBetAt: market.firstBetAt ?? new Date(),
        lastBetAt: new Date(),
      },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: input.userId,
        leagueId: market.leagueId,
        seasonId: market.seasonId,
        marketId: input.marketId,
        betId: bet.id,
        type: LedgerEntryType.BET_PLACED,
        amount: -input.amount,
        description: `Bet ${input.amount} points on ${outcome.label}`,
      },
    });

    return {
      betId: bet.id,
      pools: market.outcomes.map((o) => ({
        outcomeId: o.id,
        pool: o.id === outcome.id ? outcomePoolAfter : o.pool,
      })),
      stakeTotal: exposure + input.amount,
    };
  });
}

export async function recordBetFailure(userId: string, marketId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown bet failure";
  console.warn(`[bet failure] user=${userId} market=${marketId}: ${message}`);
  await prisma.appLog.create({
    data: {
      level: AppLogLevel.WARN,
      eventType: AppLogEventType.BET_FAILURE,
      message,
      userId,
      marketId,
    },
  });
}
