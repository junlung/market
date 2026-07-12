import { LedgerEntryType, Prisma } from "@prisma/client";
import { getIsoWeekKey } from "@/lib/allowance";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { ensureGlobalLeague } from "@/lib/server/league-service";

/**
 * Credits the current ISO week's allowance if this user doesn't have it yet.
 *
 * Idempotency and race-safety come from the unique [userId, allowanceWeek]
 * constraint on LedgerEntry — a concurrent duplicate insert fails with P2002
 * and is swallowed. Missed weeks are never back-paid: only the current week's
 * key is checked. Never throws; a page render must not 500 over bookkeeping.
 */
export async function ensureWeeklyAllowance(userId: string) {
  const allowanceWeek = getIsoWeekKey(new Date());

  try {
    const existing = await prisma.ledgerEntry.findUnique({
      where: { userId_allowanceWeek: { userId, allowanceWeek } },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    // the weekly allowance is a Global League grant (custom leagues get
    // their own allowance setting in 2b)
    const league = await ensureGlobalLeague();

    await prisma.ledgerEntry.create({
      data: {
        userId,
        leagueId: league.id,
        type: LedgerEntryType.WEEKLY_ALLOWANCE,
        amount: appConfig.weeklyAllowance,
        allowanceWeek,
        description: `Weekly allowance ${allowanceWeek}`,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }

    console.warn(`[allowance] failed for user=${userId}:`, error);
  }
}

/** Whether this user's allowance for the current ISO week has been credited. */
export async function hasCurrentWeekAllowance(userId: string) {
  const allowanceWeek = getIsoWeekKey(new Date());
  const existing = await prisma.ledgerEntry.findUnique({
    where: { userId_allowanceWeek: { userId, allowanceWeek } },
    select: { id: true },
  });
  return existing !== null;
}
