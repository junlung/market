import { randomBytes } from "node:crypto";
import {
  AppLogEventType,
  AppLogLevel,
  LeagueBalancePolicy,
  LeagueInviteStatus,
  LeagueJoinPolicy,
  LeagueRole,
  LedgerEntryType,
  Prisma,
  SeasonStatus,
  UserRole,
  UserStatus,
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
          categories: ["General"],
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
 * Resolves a raw invite code (any formatting) to its league, or null if the
 * code doesn't match a custom league. The join form and /join/[code] both go
 * through here so they can never disagree on normalization.
 */
export async function getLeagueByInviteCode(rawCode: string) {
  const code = normalizeInviteCode(rawCode);
  if (code.length === 0) {
    return null;
  }

  const league = await prisma.league.findUnique({
    where: { inviteCode: code },
    include: { _count: { select: { memberships: true } } },
  });
  return !league || league.isGlobal ? null : league;
}

/**
 * Joins a league by its rotating invite code. Idempotent for existing
 * members; grants the current season's fresh stack to mid-season joiners so
 * they can play immediately.
 */
export async function joinLeagueByCode(userId: string, rawCode: string) {
  const league = await getLeagueByInviteCode(rawCode);
  if (!league) {
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

// ---------------------------------------------------------------------------
// League invites — joining is always the invitee's choice (accept/decline),
// never a direct add. At most one PENDING invite per (league, invitee) via
// the LeagueInvite_pending_key partial unique; declined rows are kept so a
// re-invite is just a fresh PENDING row.
// ---------------------------------------------------------------------------

/** Who may send and revoke invites. */
const INVITER_ROLES: LeagueRole[] = [LeagueRole.OWNER, LeagueRole.MOD];

/**
 * The single invite-creation write point — in-app notifications for new
 * invites (issue #3) hook in here.
 */
export async function createLeagueInvite(leagueId: string, actorId: string, inviteeUserId: string) {
  await requireLeagueRole(leagueId, actorId, INVITER_ROLES);

  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  if (league.isGlobal) {
    throw new Error("Everyone is already in the Global League.");
  }

  const invitee = await prisma.user.findUnique({
    where: { id: inviteeUserId },
    select: { id: true, name: true, status: true },
  });
  if (!invitee || invitee.status !== UserStatus.ACTIVE) {
    throw new Error("Only approved members can be invited.");
  }

  const membership = await getLeagueMembership(leagueId, inviteeUserId);
  if (membership) {
    throw new Error(`${invitee.name} is already a member of this league.`);
  }

  try {
    const invite = await prisma.leagueInvite.create({
      data: { leagueId, userId: inviteeUserId, invitedById: actorId },
    });
    await logLeagueAction(`Invited ${invitee.name} to ${league.name}`, actorId, {
      leagueId,
      inviteId: invite.id,
      inviteeUserId,
    });
    return invite;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`${invitee.name} already has a pending invite to this league.`);
    }
    throw error;
  }
}

/**
 * Accepting = the same membership + fresh-stack work as a code join (both
 * idempotent via uniques), then claiming the invite row last — a crash in
 * between leaves a PENDING invite whose re-accept self-heals. The season is
 * resolved at accept time, so one that started after the invite still deals.
 */
export async function acceptLeagueInvite(inviteId: string, userId: string) {
  const invite = await prisma.leagueInvite.findFirst({
    where: { id: inviteId, userId },
    include: { league: true },
  });
  if (!invite) {
    throw new Error("That invite is gone — ask for a new one.");
  }
  if (invite.status === LeagueInviteStatus.ACCEPTED) {
    return invite.league; // double-click / re-entry
  }
  if (invite.status === LeagueInviteStatus.DECLINED) {
    throw new Error("You already declined this invite — ask for a new one.");
  }

  await ensureLeagueMembership(invite.league.id, userId);

  const activeSeason = await getActiveSeason(invite.league.id);
  if (activeSeason && invite.league.balancePolicy === LeagueBalancePolicy.FRESH_PER_SEASON) {
    await grantSeasonStack(userId, invite.league, activeSeason);
  }

  const claimed = await prisma.leagueInvite.updateMany({
    where: { id: inviteId, status: LeagueInviteStatus.PENDING },
    data: { status: LeagueInviteStatus.ACCEPTED, respondedAt: new Date() },
  });
  if (claimed.count === 0) {
    const current = await prisma.leagueInvite.findUnique({ where: { id: inviteId } });
    if (current?.status !== LeagueInviteStatus.ACCEPTED) {
      throw new Error("That invite is no longer pending."); // revoked mid-flight
    }
  }

  await logLeagueAction(`Accepted invite to ${invite.league.name}`, userId, {
    leagueId: invite.league.id,
  });
  return invite.league;
}

/** Declining is silent — the inviter's pending list just shrinks. */
export async function declineLeagueInvite(inviteId: string, userId: string) {
  const declined = await prisma.leagueInvite.updateMany({
    where: { id: inviteId, userId, status: LeagueInviteStatus.PENDING },
    data: { status: LeagueInviteStatus.DECLINED, respondedAt: new Date() },
  });
  if (declined.count === 0) {
    throw new Error("That invite is no longer pending.");
  }
  await logLeagueAction(`Declined a league invite`, userId, { inviteId });
}

/**
 * Revoking deletes the PENDING row outright — from the invitee's view the
 * invite never happened. Racing an accept/decline is a silent no-op (the
 * response wins). The role check runs here, at revoke time, so an inviter
 * demoted since sending can no longer revoke.
 */
export async function revokeLeagueInvite(inviteId: string, actorId: string) {
  const invite = await prisma.leagueInvite.findUnique({ where: { id: inviteId } });
  if (!invite) {
    return;
  }
  await requireLeagueRole(invite.leagueId, actorId, INVITER_ROLES);

  const deleted = await prisma.leagueInvite.deleteMany({
    where: { id: inviteId, status: LeagueInviteStatus.PENDING },
  });
  if (deleted.count === 1) {
    await logLeagueAction(`Revoked a league invite`, actorId, {
      leagueId: invite.leagueId,
      inviteeUserId: invite.userId,
    });
  }
}

/** The viewer's open invites, for the /leagues page. */
export async function listPendingInvitesForUser(userId: string) {
  return prisma.leagueInvite.findMany({
    where: { userId, status: LeagueInviteStatus.PENDING },
    include: {
      league: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          _count: { select: { memberships: true } },
        },
      },
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** A league's outstanding invites, for the settings page (PENDING only — declines are silent). */
export async function listLeagueInvites(
  leagueId: string,
  statuses: LeagueInviteStatus[] = [LeagueInviteStatus.PENDING],
) {
  return prisma.leagueInvite.findMany({
    where: { leagueId, status: { in: statuses } },
    include: {
      user: { select: { id: true, name: true, username: true } },
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Approved members who can still be invited: not in the league, no open invite. */
export async function listInvitableUsers(leagueId: string) {
  return prisma.user.findMany({
    where: {
      status: UserStatus.ACTIVE,
      leagueMemberships: { none: { leagueId } },
      leagueInvitesReceived: { none: { leagueId, status: LeagueInviteStatus.PENDING } },
    },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });
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

/**
 * Replaces the league's market category list (labels, not slugs — custom
 * leagues have no achievements to anchor). Editable any time, unlike the
 * economy settings: markets keep whatever string they were created with, so
 * removing a label never touches existing markets.
 */
export async function updateLeagueCategories(
  leagueId: string,
  actorId: string,
  categories: string[],
) {
  await requireLeagueRole(leagueId, actorId, [LeagueRole.OWNER]);

  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { isGlobal: true },
  });
  if (league.isGlobal) {
    throw new Error("Global League categories are fixed in code, not settings.");
  }

  const cleaned = categories.map((category) => category.trim()).filter(Boolean);
  if (cleaned.length < 1 || cleaned.length > 12) {
    throw new Error("Leagues have between 1 and 12 categories.");
  }
  if (cleaned.some((category) => category.length < 2 || category.length > 24)) {
    throw new Error("Category names are 2–24 characters.");
  }
  if (new Set(cleaned.map((category) => category.toLowerCase())).size !== cleaned.length) {
    throw new Error("Category names must be unique.");
  }

  return prisma.league.update({
    where: { id: leagueId },
    data: { categories: cleaned },
  });
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
 * Deletes a custom league and everything scoped to it: ledger entries and
 * markets go explicitly (their league FKs are Restrict), then the league row
 * cascades memberships, invites, and seasons. Season trophies survive — they
 * are UserItem rows with provenance strings, not league FKs.
 *
 * OWNER only (app admins bypass via requireLeagueRole). Refuses the Global
 * League and any league with an ACTIVE season — finish or cancel the season
 * first, so a live game can't be rage-deleted out from under its members.
 * `confirmName` must match the league's exact name (the UI's type-to-confirm
 * gate, re-checked here so the server never trusts the client's disable state).
 */
export async function deleteLeague(leagueId: string, actorId: string, confirmName: string) {
  await requireLeagueRole(leagueId, actorId, [LeagueRole.OWNER]);

  const league = await prisma.league.findUniqueOrThrow({
    where: { id: leagueId },
    select: { id: true, name: true, slug: true, isGlobal: true },
  });
  if (league.isGlobal) {
    throw new Error("The Global League can't be deleted.");
  }
  if (confirmName.trim() !== league.name) {
    throw new Error("Type the league's exact name to confirm.");
  }

  await prisma.$transaction(async (tx) => {
    const activeSeason = await tx.season.findFirst({
      where: { leagueId, status: SeasonStatus.ACTIVE },
      select: { id: true },
    });
    if (activeSeason) {
      throw new Error("This league has a season in progress — finish it before deleting.");
    }

    await tx.ledgerEntry.deleteMany({ where: { leagueId } });
    await tx.market.deleteMany({ where: { leagueId } });
    await tx.league.delete({ where: { id: leagueId } });
  });

  await logLeagueAction(`Deleted league: ${league.name} (${league.slug})`, actorId, {
    leagueId,
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

/**
 * The viewer's spendable stack in each of their custom leagues — the top-nav
 * balance menu. Fresh-stack leagues with no running season read as dormant
 * (their balance is 0 by construction until the next season deals).
 */
export async function getLeagueStacks(userId: string) {
  const memberships = await listUserLeagues(userId);
  return Promise.all(
    memberships.map(async ({ league }) => {
      const season =
        league.balancePolicy === LeagueBalancePolicy.FRESH_PER_SEASON
          ? await getActiveSeason(league.id)
          : null;
      const balance = await getLeagueBalance(userId, {
        leagueId: league.id,
        balancePolicy: league.balancePolicy,
        seasonId: season?.id ?? null,
      });
      return {
        slug: league.slug,
        name: league.name,
        balance,
        seasonName: season?.name ?? null,
        dormant:
          league.balancePolicy === LeagueBalancePolicy.FRESH_PER_SEASON && season === null,
      };
    }),
  );
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
