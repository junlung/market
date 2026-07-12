import { LeagueBalancePolicy, LedgerEntryType, Prisma, SeasonStatus } from "@prisma/client";
import { getIsoWeekKey } from "@/lib/allowance";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { ensureGlobalLeague } from "@/lib/server/league-service";

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Credits the current ISO week's allowance if this user doesn't have it yet.
 *
 * Idempotency and race-safety come from the unique
 * [userId, leagueId, allowanceWeek] constraint on LedgerEntry — a concurrent
 * duplicate insert fails with P2002 and is swallowed. Missed weeks are never
 * back-paid: only the current week's key is checked. Never throws; a page
 * render must not 500 over bookkeeping.
 */
export async function ensureWeeklyAllowance(userId: string) {
  const allowanceWeek = getIsoWeekKey(new Date());

  try {
    // the weekly allowance is a Global League grant (custom leagues have
    // their own allowance setting — see ensureLeagueAllowance)
    const league = await ensureGlobalLeague();

    const existing = await prisma.ledgerEntry.findUnique({
      where: {
        userId_leagueId_allowanceWeek: { userId, leagueId: league.id, allowanceWeek },
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }

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
    if (isUniqueViolation(error)) {
      return;
    }

    console.warn(`[allowance] failed for user=${userId}:`, error);
  }
}

/**
 * The custom-league counterpart: honors the league's weeklyAllowance setting
 * (0 = off), only pays members, and — in fresh-stack leagues — only while a
 * season is active, stamping the entry into that season's stack. Same
 * never-throws contract as the global path.
 */
export async function ensureLeagueAllowance(
  userId: string,
  league: {
    id: string;
    name: string;
    isGlobal: boolean;
    weeklyAllowance: number;
    balancePolicy: LeagueBalancePolicy;
  },
) {
  if (league.isGlobal || league.weeklyAllowance <= 0) {
    return;
  }

  const allowanceWeek = getIsoWeekKey(new Date());

  try {
    const membership = await prisma.leagueMembership.findUnique({
      where: { leagueId_userId: { leagueId: league.id, userId } },
      select: { id: true },
    });
    if (!membership) {
      return;
    }

    // fresh-stack allowances top up the ACTIVE season's stack; the allowance
    // always follows the current season, never an old market's
    let seasonId: string | null = null;
    if (league.balancePolicy === LeagueBalancePolicy.FRESH_PER_SEASON) {
      const now = new Date();
      const season = await prisma.season.findFirst({
        where: {
          leagueId: league.id,
          status: SeasonStatus.ACTIVE,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        select: { id: true },
      });
      if (!season) {
        return;
      }
      seasonId = season.id;
    }

    const existing = await prisma.ledgerEntry.findUnique({
      where: {
        userId_leagueId_allowanceWeek: { userId, leagueId: league.id, allowanceWeek },
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    await prisma.ledgerEntry.create({
      data: {
        userId,
        leagueId: league.id,
        seasonId,
        type: LedgerEntryType.WEEKLY_ALLOWANCE,
        amount: league.weeklyAllowance,
        allowanceWeek,
        description: `Weekly allowance ${allowanceWeek} — ${league.name}`,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return;
    }

    console.warn(`[allowance] league=${league.id} failed for user=${userId}:`, error);
  }
}

/** Whether this user's Global League allowance for the current ISO week has been credited. */
export async function hasCurrentWeekAllowance(userId: string) {
  const league = await ensureGlobalLeague();
  const allowanceWeek = getIsoWeekKey(new Date());
  const existing = await prisma.ledgerEntry.findUnique({
    where: {
      userId_leagueId_allowanceWeek: { userId, leagueId: league.id, allowanceWeek },
    },
    select: { id: true },
  });
  return existing !== null;
}
