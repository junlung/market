import { LedgerEntryType, MarketKind, MarketStatus, Prisma } from "@prisma/client";
import { sumLedgerAmounts } from "@/lib/ledger";
import { assertSafeInt } from "@/lib/parimutuel";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureLeagueAllowance, ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { balanceWhere } from "@/lib/server/league-service";
import { withSerializableRetry } from "@/lib/server/tx";

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Place or move a guess in a CLOSEST_GUESS market. The ante is charged once,
 * at first placement; edits until close just move the claimed date. Dates are
 * first-come-first-claimed ([marketId, value] unique — the availability check
 * inside the transaction is the fast path, the unique is the race backstop).
 * This is a money-moving write path: it runs in withSerializableRetry like
 * bet placement, and must tolerate full re-runs.
 */
export async function placeGuess(input: {
  userId: string;
  marketId: string;
  value: Date;
  skipRateLimit?: boolean;
}) {
  enforceRateLimit(`guess:${input.userId}:${input.marketId}`, { skip: input.skipRateLimit });

  if (Number.isNaN(input.value.getTime())) {
    throw new Error("Pick a valid date.");
  }

  // lazy allowances before the balance check, mirroring placeBet
  const allowanceTarget = await prisma.market.findUnique({
    where: { id: input.marketId },
    select: { league: true },
  });
  await ensureWeeklyAllowance(input.userId);
  if (allowanceTarget && !allowanceTarget.league.isGlobal) {
    await ensureLeagueAllowance(input.userId, allowanceTarget.league);
  }

  try {
    return await withSerializableRetry(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: input.marketId },
        include: { league: { select: { id: true, balancePolicy: true } } },
      });

      if (!market) {
        throw new Error("Market not found.");
      }
      if (market.kind !== MarketKind.CLOSEST_GUESS) {
        throw new Error("This market takes bets, not guesses.");
      }
      if (market.status !== MarketStatus.OPEN) {
        throw new Error("Guessing is closed for this market.");
      }
      if (market.closeTime <= new Date()) {
        throw new Error("This market is past its close time.");
      }
      const ante = market.anteAmount ?? 0;
      assertSafeInt(ante, "Ante");
      if (ante < 1) {
        throw new Error("This market has no ante configured.");
      }

      const membership = await tx.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId: market.leagueId, userId: input.userId } },
        select: { id: true },
      });
      if (!membership) {
        throw new Error("Only league members can enter this market.");
      }

      const taken = await tx.guess.findUnique({
        where: { marketId_value: { marketId: input.marketId, value: input.value } },
        select: { userId: true },
      });
      if (taken && taken.userId !== input.userId) {
        throw new Error("That date is already claimed — pick another.");
      }

      const existing = await tx.guess.findUnique({
        where: { marketId_userId: { marketId: input.marketId, userId: input.userId } },
      });

      if (existing) {
        // moving the claim — the ante is already in the pot
        return tx.guess.update({
          where: { id: existing.id },
          data: { value: input.value },
        });
      }

      const balanceEntries = await tx.ledgerEntry.findMany({
        where: balanceWhere(input.userId, {
          leagueId: market.leagueId,
          balancePolicy: market.league.balancePolicy,
          seasonId: market.seasonId,
        }),
        select: { amount: true },
      });
      if (ante > sumLedgerAmounts(balanceEntries)) {
        throw new Error("Insufficient balance for the ante.");
      }

      const guess = await tx.guess.create({
        data: { userId: input.userId, marketId: input.marketId, value: input.value },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: input.userId,
          leagueId: market.leagueId,
          seasonId: market.seasonId,
          marketId: input.marketId,
          type: LedgerEntryType.BET_PLACED,
          amount: -ante,
          description: `Ante ${ante} points — ${market.title}`,
        },
      });

      // the write-write fence against a concurrent resolution, like placeBet
      await tx.market.update({
        where: { id: input.marketId },
        data: {
          firstBetAt: market.firstBetAt ?? new Date(),
          lastBetAt: new Date(),
        },
      });

      return guess;
    });
  } catch (error) {
    // a date-claim race that survived the retries surfaces as the friendly error
    if (isUniqueViolation(error) && (error.meta?.target as string[])?.includes("value")) {
      throw new Error("That date is already claimed — pick another.");
    }
    throw error;
  }
}

/** All guesses in a market, in date order, with entrant identity. */
export async function listGuesses(marketId: string) {
  return prisma.guess.findMany({
    where: { marketId },
    orderBy: { value: "asc" },
    include: { user: { select: { name: true, username: true } } },
  });
}
