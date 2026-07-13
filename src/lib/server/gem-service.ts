import { GemLedgerEntryType } from "@prisma/client";
import { GEM_STARTING_GRANT, SEASON_PLACEMENT_GEMS } from "@/lib/achievements";
import { buildGemBreakdown, type GemBreakdown } from "@/lib/gems";
import { prisma } from "@/lib/prisma";

/** Gems are one global wallet: balance = SUM over the user's whole ledger. */
export async function getGemBalance(userId: string) {
  const result = await prisma.gemLedgerEntry.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function getGemBreakdown(userId: string): Promise<GemBreakdown> {
  const groups = await prisma.gemLedgerEntry.groupBy({
    by: ["type"],
    where: { userId },
    _sum: { amount: true },
  });
  return buildGemBreakdown(
    groups.map((group) => ({ type: group.type, amount: group._sum.amount ?? 0 })),
  );
}

/** Recent gem activity for the account page, provenance names included. */
export async function listGemLedger(userId: string, limit = 20) {
  return prisma.gemLedgerEntry.findMany({
    where: { userId },
    include: {
      market: { select: { title: true } },
      season: { select: { name: true } },
      item: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Season placement gems (Global League only — decision #1), granted beside
 * the placement trophy in finalizeDueSeasons and by the launch backfill.
 * Idempotent via the partial unique on (userId, seasonId) WHERE
 * SEASON_PLACEMENT; ties share the tied rank's amount, like trophies.
 */
export async function grantPlacementGems(input: {
  userId: string;
  seasonId: string;
  rank: number;
  seasonName: string;
  leagueName: string;
}) {
  const amount = SEASON_PLACEMENT_GEMS[input.rank - 1];
  if (!amount) {
    return null;
  }

  try {
    return await prisma.gemLedgerEntry.create({
      data: {
        userId: input.userId,
        type: GemLedgerEntryType.SEASON_PLACEMENT,
        amount,
        seasonId: input.seasonId,
        description: `Placed #${input.rank} — ${input.seasonName} · ${input.leagueName}`,
      },
    });
  } catch (error) {
    const isUniqueViolation =
      error && typeof error === "object" && "code" in error && error.code === "P2002";
    if (isUniqueViolation) {
      return null; // already granted (cron re-run or backfill overlap)
    }
    throw error;
  }
}

/**
 * The one-time gem starting allowance, granted at account approval and by the
 * launch backfill. Idempotent forever via the partial unique on (userId)
 * WHERE STARTING_GRANT — reject/approve cycles and backfill re-runs no-op.
 * Returns null when the user already has theirs.
 */
export async function grantStartingGems(userId: string) {
  try {
    return await prisma.gemLedgerEntry.create({
      data: {
        userId,
        type: GemLedgerEntryType.STARTING_GRANT,
        amount: GEM_STARTING_GRANT,
        description: "Starting gems",
      },
    });
  } catch (error) {
    const isUniqueViolation =
      error && typeof error === "object" && "code" in error && error.code === "P2002";
    if (isUniqueViolation) {
      return null;
    }
    throw error;
  }
}

/** Admin escape hatch — signed adjustment with an audit note. No UI in 3a. */
export async function adjustGems(userId: string, amount: number, note: string) {
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new Error("Adjustment must be a non-zero integer.");
  }
  return prisma.gemLedgerEntry.create({
    data: {
      userId,
      type: GemLedgerEntryType.ADMIN_ADJUST,
      amount,
      description: note,
    },
  });
}
