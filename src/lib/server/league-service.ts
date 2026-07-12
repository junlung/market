import { LeagueBalancePolicy, LeagueJoinPolicy, Prisma } from "@prisma/client";
import { GLOBAL_LEAGUE_SLUG } from "@/lib/leagues";
import { prisma } from "@/lib/prisma";

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * The Global League row. The migration seeds it in deployed databases; fresh
 * databases that skip migrations (prisma db push in tests, local resets) get
 * it created on first touch here. Idempotent and race-safe via the unique
 * slug — no module-level cache, so test suites that wipe tables can't hold a
 * stale id.
 */
export async function ensureGlobalLeague() {
  const existing = await prisma.league.findUnique({ where: { slug: GLOBAL_LEAGUE_SLUG } });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.league.create({
      data: {
        slug: GLOBAL_LEAGUE_SLUG,
        name: "Global League",
        description:
          "Every member plays here. The leaderboard resets monthly; balances and markets carry over.",
        isGlobal: true,
        joinPolicy: LeagueJoinPolicy.APPROVAL,
        balancePolicy: LeagueBalancePolicy.PERSISTENT,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return prisma.league.findUniqueOrThrow({ where: { slug: GLOBAL_LEAGUE_SLUG } });
    }
    throw error;
  }
}

/**
 * Enrolls a user in a league, idempotently — re-approvals and migration
 * backfills can overlap without duplicating rows. Roles gate nothing in 2a.
 */
export async function ensureLeagueMembership(leagueId: string, userId: string) {
  try {
    return await prisma.leagueMembership.create({ data: { leagueId, userId } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return prisma.leagueMembership.findUniqueOrThrow({
        where: { leagueId_userId: { leagueId, userId } },
      });
    }
    throw error;
  }
}
