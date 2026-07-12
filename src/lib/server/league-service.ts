import { randomBytes } from "node:crypto";
import {
  AppLogEventType,
  AppLogLevel,
  LeagueBalancePolicy,
  LeagueJoinPolicy,
  LeagueRole,
  LedgerEntryType,
  Prisma,
  SeasonStatus,
  UserRole,
} from "@prisma/client";
import {
  GLOBAL_LEAGUE_SLUG,
  INVITE_CODE_ALPHABET,
  normalizeInviteCode,
  suggestLeagueSlug,
} from "@/lib/leagues";
import { assertSafeInt } from "@/lib/parimutuel";
import { prisma } from "@/lib/prisma";

/**
 * What a balance is scoped to. PERSISTENT leagues (the Global League) sum
 * every entry in the league; FRESH_PER_SEASON leagues sum only the given
 * season's entries — that's the whole "fresh stack" mechanic. A fresh-stack
 * scope with seasonId null matches nothing, so "no active season" reads as a
 * zero balance instead of leaking a previous season's points.
 */
export type BalanceScope = {
  leagueId: string;
  balancePolicy: LeagueBalancePolicy;
  seasonId?: string | null;
};

export function balanceWhere(userId: string, scope: BalanceScope) {
  return {
    userId,
    leagueId: scope.leagueId,
    ...(scope.balancePolicy === LeagueBalancePolicy.FRESH_PER_SEASON
      ? { seasonId: scope.seasonId ?? null }
      : {}),
  };
}

/** A user's spendable balance inside one league (see BalanceScope). */
export async function getLeagueBalance(userId: string, scope: BalanceScope) {
  const result = await prisma.ledgerEntry.aggregate({
    where: balanceWhere(userId, scope),
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

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
 * backfills can overlap without duplicating rows.
 */
export async function ensureLeagueMembership(
  leagueId: string,
  userId: string,
  role: LeagueRole = LeagueRole.MEMBER,
) {
  try {
    return await prisma.leagueMembership.create({ data: { leagueId, userId, role } });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return prisma.leagueMembership.findUniqueOrThrow({
        where: { leagueId_userId: { leagueId, userId } },
      });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Custom leagues (2b)
// ---------------------------------------------------------------------------

function generateInviteCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length];
  }
  return code;
}

function logLeagueAction(message: string, actorId: string, metadata?: object) {
  return prisma.appLog.create({
    data: {
      level: AppLogLevel.INFO,
      eventType: AppLogEventType.MEMBERSHIP_ACTION,
      message,
      userId: actorId,
      ...(metadata ? { metadata } : {}),
    },
  });
}

export type LeagueSettingsInput = {
  startingStack: number;
  weeklyAllowance: number;
  defaultRakeBps: number;
  defaultMaxStakePerUser: number;
};

function assertSettings(settings: LeagueSettingsInput) {
  assertSafeInt(settings.startingStack, "Starting stack");
  assertSafeInt(settings.defaultMaxStakePerUser, "Stake cap");
  if (settings.startingStack < 1) {
    throw new Error("The starting stack must be at least 1 point.");
  }
  if (settings.weeklyAllowance < 0 || !Number.isSafeInteger(settings.weeklyAllowance)) {
    throw new Error("The weekly allowance must be 0 (off) or a positive whole number.");
  }
  if (settings.defaultRakeBps < 0 || settings.defaultRakeBps > 2000) {
    throw new Error("Rake must be between 0 and 2000 basis points.");
  }
  if (settings.defaultMaxStakePerUser < 1) {
    throw new Error("The stake cap must be at least 1 point.");
  }
}

/** Creates a custom league: unique slug from the name, OWNER membership, join code. */
export async function createLeague(input: {
  ownerId: string;
  name: string;
  description?: string;
  settings: LeagueSettingsInput;
}) {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 60) {
    throw new Error("League names are 3–60 characters.");
  }
  assertSettings(input.settings);

  const base = suggestLeagueSlug(name);
  const taken = await prisma.league.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const takenSlugs = new Set(taken.map((league) => league.slug));
  let slug = base;
  for (let suffix = 2; takenSlugs.has(slug); suffix += 1) {
    slug = `${base.slice(0, 30 - `-${suffix}`.length)}-${suffix}`;
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      const league = await prisma.league.create({
        data: {
          slug,
          name,
          description: input.description?.trim() || null,
          isGlobal: false,
          ownerId: input.ownerId,
          joinPolicy: LeagueJoinPolicy.INVITE_CODE,
          balancePolicy: LeagueBalancePolicy.FRESH_PER_SEASON,
          inviteCode: generateInviteCode(),
          ...input.settings,
          memberships: { create: { userId: input.ownerId, role: LeagueRole.OWNER } },
        },
      });
      await logLeagueAction(`Created league: ${name} (${slug})`, input.ownerId);
      return league;
    } catch (error) {
      // slug/code collision race — regenerate and retry a couple of times
      if (isUniqueViolation(error) && attempt < 3) {
        slug = `${base.slice(0, 30 - 5)}-${randomBytes(2).readUInt16BE(0) % 1000}`;
        continue;
      }
      throw error;
    }
  }
}

/**
 * Joins a league by its rotating invite code. Idempotent for existing
 * members; grants the current season's fresh stack to mid-season joiners so
 * they can play immediately.
 */
export async function joinLeagueByCode(userId: string, rawCode: string) {
  const code = normalizeInviteCode(rawCode);
  if (code.length === 0) {
    throw new Error("Enter an invite code.");
  }

  const league = await prisma.league.findUnique({ where: { inviteCode: code } });
  if (!league || league.isGlobal) {
    throw new Error("That invite code doesn't match any league.");
  }

  await ensureLeagueMembership(league.id, userId);

  const activeSeason = await getActiveSeason(league.id);
  if (activeSeason && league.balancePolicy === LeagueBalancePolicy.FRESH_PER_SEASON) {
    await grantSeasonStack(userId, league, activeSeason);
  }

  await logLeagueAction(`Joined league: ${league.name}`, userId, { leagueId: league.id });
  return league;
}

/** The league's currently-running season, if any. */
export async function getActiveSeason(leagueId: string, now = new Date()) {
  return prisma.season.findFirst({
    where: {
      leagueId,
      status: SeasonStatus.ACTIVE,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
  });
}

/** The next scheduled (not yet started) season, if any. */
export async function getUpcomingSeason(leagueId: string) {
  return prisma.season.findFirst({
    where: { leagueId, status: SeasonStatus.UPCOMING },
    orderBy: { startsAt: "asc" },
  });
}

/**
 * One fresh stack per user per season, race-safe via the partial unique
 * [userId, seasonId] WHERE type = SEASON_STACK. Called for every member at
 * season start and for anyone joining mid-season.
 */
export async function grantSeasonStack(
  userId: string,
  league: { id: string; name: string; startingStack: number },
  season: { id: string; name: string },
) {
  try {
    return await prisma.ledgerEntry.create({
      data: {
        userId,
        leagueId: league.id,
        seasonId: season.id,
        type: LedgerEntryType.SEASON_STACK,
        amount: league.startingStack,
        description: `Starting stack — ${league.name}, ${season.name}`,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return null; // already granted
    }
    throw error;
  }
}

/** Rotates the join code — the old one stops working immediately. */
export async function rotateInviteCode(leagueId: string, actorId: string) {
  await requireLeagueRole(leagueId, actorId, [LeagueRole.OWNER, LeagueRole.MOD]);

  for (let attempt = 1; ; attempt += 1) {
    try {
      const league = await prisma.league.update({
        where: { id: leagueId },
        data: { inviteCode: generateInviteCode() },
      });
      await logLeagueAction(`Rotated invite code for ${league.name}`, actorId);
      return league;
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 3) {
        continue;
      }
      throw error;
    }
  }
}

/**
 * Economy settings are editable until the first season starts — after that
 * stacks have been granted against them and changing the rules mid-game
 * would be a bait-and-switch. Name and description stay editable.
 */
export async function updateLeagueSettings(
  leagueId: string,
  actorId: string,
  input: { name: string; description?: string; settings: LeagueSettingsInput },
) {
  await requireLeagueRole(leagueId, actorId, [LeagueRole.OWNER]);

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.isGlobal) {
    throw new Error("The Global League is configured by the app, not from here.");
  }

  const name = input.name.trim();
  if (name.length < 3 || name.length > 60) {
    throw new Error("League names are 3–60 characters.");
  }

  const started = await prisma.season.findFirst({
    where: { leagueId, startsAt: { lte: new Date() } },
    select: { id: true },
  });

  if (started) {
    const changed =
      league.startingStack !== input.settings.startingStack ||
      league.weeklyAllowance !== input.settings.weeklyAllowance ||
      league.defaultRakeBps !== input.settings.defaultRakeBps ||
      league.defaultMaxStakePerUser !== input.settings.defaultMaxStakePerUser;
    if (changed) {
      throw new Error("Economy settings lock once the first season starts.");
    }
  } else {
    assertSettings(input.settings);
  }

  const updated = await prisma.league.update({
    where: { id: leagueId },
    data: {
      name,
      description: input.description?.trim() || null,
      ...(started ? {} : input.settings),
    },
  });
  await logLeagueAction(`Updated league settings: ${updated.name}`, actorId);
  return updated;
}

/** Owner promotes/demotes members between MEMBER and MOD. Ownership doesn't transfer in v1. */
export async function setMemberRole(
  leagueId: string,
  actorId: string,
  targetUserId: string,
  role: typeof LeagueRole.MOD | typeof LeagueRole.MEMBER,
) {
  await requireLeagueRole(leagueId, actorId, [LeagueRole.OWNER]);

  const target = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId, userId: targetUserId } },
  });
  if (!target) {
    throw new Error("That person isn't a member of this league.");
  }
  if (target.role === LeagueRole.OWNER) {
    throw new Error("The owner's role can't be changed.");
  }

  return prisma.leagueMembership.update({
    where: { id: target.id },
    data: { role },
  });
}

/**
 * Gate for league operations: the league's OWNER/MODs (per `roles`) — or an
 * app admin, who can operate any league as the deployment's safety valve.
 */
export async function requireLeagueRole(leagueId: string, userId: string, roles: LeagueRole[]) {
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.leagueMembership.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: { role: true },
    }),
  ]);

  if (user?.role === UserRole.ADMIN) {
    return;
  }
  if (!membership || !roles.includes(membership.role)) {
    throw new Error("You don't have permission to do that in this league.");
  }
}

/** The viewer's membership row in a league, or null. */
export async function getLeagueMembership(leagueId: string, userId: string) {
  return prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
  });
}

/** Soft form of requireLeagueRole for conditional UI (manage panels). */
export async function canOperateLeague(leagueId: string, userId: string) {
  try {
    await requireLeagueRole(leagueId, userId, [LeagueRole.OWNER, LeagueRole.MOD]);
    return true;
  } catch {
    return false;
  }
}

/** League + the viewer's membership — league pages are members-only. */
export async function getLeagueForViewer(slug: string, viewerId: string) {
  const league = await prisma.league.findUnique({
    where: { slug },
    include: {
      owner: { select: { id: true, name: true, username: true } },
      _count: { select: { memberships: true } },
    },
  });
  if (!league) {
    return null;
  }

  const membership = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId: league.id, userId: viewerId } },
  });

  return { league, membership };
}

/** The viewer's custom leagues (the Global League is the app itself). */
export async function listUserLeagues(userId: string) {
  const memberships = await prisma.leagueMembership.findMany({
    where: { userId, league: { isGlobal: false } },
    include: {
      league: { include: { _count: { select: { memberships: true } } } },
    },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((membership) => ({
    role: membership.role,
    joinedAt: membership.joinedAt,
    league: membership.league,
  }));
}

/** Everyone in the league, owner first, then mods, then join order. */
export async function listLeagueMembers(leagueId: string) {
  const memberships = await prisma.leagueMembership.findMany({
    where: { leagueId },
    include: { user: { select: { id: true, name: true, username: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const rank = { [LeagueRole.OWNER]: 0, [LeagueRole.MOD]: 1, [LeagueRole.MEMBER]: 2 };
  return memberships.sort((a, b) => rank[a.role] - rank[b.role]);
}
