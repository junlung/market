import { AppLogEventType, AppLogLevel, BetSide, LedgerEntryType, MarketStatus } from "@prisma/client";
import { sumLedgerAmounts } from "@/lib/ledger";
import { assertSafeInt } from "@/lib/parimutuel";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { withSerializableRetry } from "@/lib/server/tx";

export type PlaceBetResult = {
  betId: string;
  yesPool: number;
  noPool: number;
  stakeTotal: number;
};

export async function placeBet(input: {
  userId: string;
  marketId: string;
  side: BetSide;
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
    });

    if (!market) {
      throw new Error("Market not found.");
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

    const existingStake = await tx.poolStake.findUnique({
      where: { userId_marketId: { userId: input.userId, marketId: input.marketId } },
    });
    const exposure = (existingStake?.yesStake ?? 0) + (existingStake?.noStake ?? 0);

    if (exposure + input.amount > market.maxStakePerUser) {
      const remaining = Math.max(market.maxStakePerUser - exposure, 0);
      throw new Error(
        remaining > 0
          ? `Stake cap is ${market.maxStakePerUser} points per player — you can add up to ${remaining} more.`
          : `You've hit this market's ${market.maxStakePerUser}-point stake cap.`,
      );
    }

    const yesPoolAfter = market.yesPool + (input.side === BetSide.YES ? input.amount : 0);
    const noPoolAfter = market.noPool + (input.side === BetSide.NO ? input.amount : 0);
    assertSafeInt(yesPoolAfter, "Yes pool");
    assertSafeInt(noPoolAfter, "No pool");

    const bet = await tx.bet.create({
      data: {
        userId: input.userId,
        marketId: input.marketId,
        side: input.side,
        amount: input.amount,
        yesPoolAfter,
        noPoolAfter,
      },
    });

    await tx.poolStake.upsert({
      where: { userId_marketId: { userId: input.userId, marketId: input.marketId } },
      update: {
        yesStake: input.side === BetSide.YES ? { increment: input.amount } : undefined,
        noStake: input.side === BetSide.NO ? { increment: input.amount } : undefined,
      },
      create: {
        userId: input.userId,
        marketId: input.marketId,
        yesStake: input.side === BetSide.YES ? input.amount : 0,
        noStake: input.side === BetSide.NO ? input.amount : 0,
      },
    });

    await tx.market.update({
      where: { id: input.marketId },
      data: {
        yesPool: yesPoolAfter,
        noPool: noPoolAfter,
        firstBetAt: market.firstBetAt ?? new Date(),
        lastBetAt: new Date(),
      },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: input.userId,
        marketId: input.marketId,
        betId: bet.id,
        type: LedgerEntryType.BET_PLACED,
        amount: -input.amount,
        description: `Bet ${input.amount} points on ${input.side}`,
      },
    });

    return {
      betId: bet.id,
      yesPool: yesPoolAfter,
      noPool: noPoolAfter,
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
