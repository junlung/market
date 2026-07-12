import { AppLogEventType, AppLogLevel, BetSide, LedgerEntryType, MarketStatus } from "@prisma/client";
import { sumLedgerAmounts } from "@/lib/ledger";
import { assertSafeInt } from "@/lib/parimutuel";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
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

  await ensureWeeklyAllowance(input.userId);

  return withSerializableRetry(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: input.marketId },
      include: { outcomes: { orderBy: { sortOrder: "asc" } } },
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

    const balanceEntries = await tx.ledgerEntry.findMany({
      where: { userId: input.userId },
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

    // release-1 dual-writes keep binary markets readable by the previous
    // deploy while it still serves traffic; dropped in the contract release
    const isBinary = market.outcomes.length === 2;
    const legacySide = isBinary ? (outcome.sortOrder === 0 ? BetSide.YES : BetSide.NO) : null;
    const yesPoolAfter = isBinary
      ? market.yesPool + (outcome.sortOrder === 0 ? input.amount : 0)
      : null;
    const noPoolAfter = isBinary
      ? market.noPool + (outcome.sortOrder === 1 ? input.amount : 0)
      : null;

    const bet = await tx.bet.create({
      data: {
        userId: input.userId,
        marketId: input.marketId,
        outcomeId: outcome.id,
        amount: input.amount,
        outcomePoolAfter,
        totalPoolAfter,
        side: legacySide,
        yesPoolAfter,
        noPoolAfter,
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
        ...(legacySide === BetSide.YES ? { yesStake: { increment: input.amount } } : {}),
        ...(legacySide === BetSide.NO ? { noStake: { increment: input.amount } } : {}),
      },
      create: {
        userId: input.userId,
        marketId: input.marketId,
        outcomeId: outcome.id,
        amount: input.amount,
        yesStake: legacySide === BetSide.YES ? input.amount : 0,
        noStake: legacySide === BetSide.NO ? input.amount : 0,
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
        ...(isBinary ? { yesPool: yesPoolAfter!, noPool: noPoolAfter! } : {}),
        firstBetAt: market.firstBetAt ?? new Date(),
        lastBetAt: new Date(),
      },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: input.userId,
        leagueId: market.leagueId,
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
