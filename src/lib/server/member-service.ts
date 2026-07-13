import { AppLogEventType, AppLogLevel, LedgerEntryType, UserStatus } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { grantStartingGems } from "@/lib/server/gem-service";
import { ensureGlobalLeague, ensureLeagueMembership } from "@/lib/server/league-service";

function logMembershipAction(message: string, actorId: string) {
  return prisma.appLog.create({
    data: {
      level: AppLogLevel.INFO,
      eventType: AppLogEventType.MEMBERSHIP_ACTION,
      message,
      userId: actorId,
    },
  });
}

/**
 * Approves a pending (or previously rejected — admins can change their mind)
 * account. The starting balance is granted here — not at signup — so
 * rejected/junk signups never receive points.
 */
export async function approveUser(userId: string, adminId: string, note?: string) {
  const globalLeague = await ensureGlobalLeague();

  await prisma.$transaction(async (tx) => {
    // status guard inside the tx: double-approval must not double-grant
    const updated = await tx.user.updateMany({
      where: { id: userId, status: { in: [UserStatus.PENDING, UserStatus.REJECTED] } },
      data: {
        status: UserStatus.ACTIVE,
        reviewedById: adminId,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });

    if (updated.count === 0) {
      throw new Error("Only pending or rejected accounts can be approved.");
    }

    // belt-and-braces: never grant twice, even across reject/approve cycles
    const existingGrant = await tx.ledgerEntry.findFirst({
      where: { userId, type: LedgerEntryType.INITIAL_GRANT },
    });

    if (!existingGrant) {
      await tx.ledgerEntry.create({
        data: {
          userId,
          leagueId: globalLeague.id,
          type: LedgerEntryType.INITIAL_GRANT,
          amount: appConfig.startingBalance,
          description: "Starting balance",
        },
      });
    }
  });

  // approval is when a member joins the Global League (idempotent — the
  // migration backfill or a prior reject/approve cycle may have enrolled them)
  await ensureLeagueMembership(globalLeague.id, userId);

  // the gem starting allowance rides approval too — DB-level idempotent, so
  // reject/approve cycles can't double-grant
  await grantStartingGems(userId);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await logMembershipAction(`Approved member: ${user.name} (${user.email})`, adminId);
  return user;
}

export async function rejectUser(userId: string, adminId: string, reason?: string) {
  const reviewNote = reason?.trim() || "Rejected by admin";
  const updated = await prisma.user.updateMany({
    where: { id: userId, status: UserStatus.PENDING },
    data: {
      status: UserStatus.REJECTED,
      reviewedById: adminId,
      reviewedAt: new Date(),
      reviewNote,
    },
  });

  if (updated.count === 0) {
    throw new Error("Only pending accounts can be rejected.");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await logMembershipAction(`Rejected signup: ${user.email} (${reviewNote})`, adminId);
  return user;
}

/**
 * Self-service display-name change. Names aren't schema-unique, but a
 * case-insensitive collision check keeps friends from impersonating each
 * other on the leaderboard and activity feeds.
 */
export async function updateDisplayName(userId: string, name: string) {
  const trimmed = name.trim();

  const taken = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      name: { equals: trimmed, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (taken) {
    throw new Error("That name is already taken.");
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true },
  });
  const updated = await prisma.user.update({ where: { id: userId }, data: { name: trimmed } });
  await logMembershipAction(`Renamed themselves: ${before.name} → ${trimmed}`, userId);
  return updated;
}

/** The signed-in member's own editable profile fields (account page). */
export async function getSelfProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, username: true, bio: true, email: true, role: true, createdAt: true },
  });
}

/**
 * Self-service username (profile handle) change. Uniqueness is schema-level;
 * the pre-check just gives a friendlier error than a P2002 in the common case.
 */
export async function updateUsername(userId: string, username: string) {
  const taken = await prisma.user.findFirst({
    where: { id: { not: userId }, username },
    select: { id: true },
  });

  if (taken) {
    throw new Error("That username is already taken.");
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { username: true },
  });

  try {
    const updated = await prisma.user.update({ where: { id: userId }, data: { username } });
    await logMembershipAction(`Changed username: @${before.username} → @${username}`, userId);
    return updated;
  } catch (error) {
    // unique-violation race between the pre-check and the update
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new Error("That username is already taken.");
    }
    throw error;
  }
}

/** Self-service profile bio. Empty clears it. */
export async function updateBio(userId: string, bio: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { bio: bio.length > 0 ? bio : null },
  });
}

/** A member vouching for someone in the queue — shown to admins on review. */
export async function vouchForUser(userId: string, voucherId: string, note?: string) {
  if (userId === voucherId) {
    throw new Error("You can't vouch for yourself.");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (user.status !== UserStatus.PENDING) {
    throw new Error("Only pending accounts can be vouched for.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { vouchedById: voucherId, vouchNote: note },
  });

  await logMembershipAction(`Vouched for ${user.name} (${user.email})`, voucherId);
  return updated;
}

export async function listPendingUsers() {
  return prisma.user.findMany({
    where: { status: UserStatus.PENDING },
    include: { vouchedBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Every account in every state, with vouch info and current balance. */
export async function getMembersOverview() {
  const members = await prisma.user.findMany({
    include: {
      vouchedBy: { select: { name: true } },
    },
    orderBy: [{ status: "desc" }, { createdAt: "asc" }],
  });

  const sums = await prisma.ledgerEntry.groupBy({
    by: ["userId"],
    _sum: { amount: true },
  });
  const balanceByUser = new Map(sums.map((row) => [row.userId, row._sum.amount ?? 0]));

  return members.map((member) => ({
    ...member,
    balance: balanceByUser.get(member.id) ?? 0,
  }));
}

export async function getUserStatusCounts() {
  const rows = await prisma.user.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const counts = { active: 0, pending: 0, rejected: 0 };
  for (const row of rows) {
    if (row.status === UserStatus.ACTIVE) counts.active = row._count._all;
    if (row.status === UserStatus.PENDING) counts.pending = row._count._all;
    if (row.status === UserStatus.REJECTED) counts.rejected = row._count._all;
  }
  return counts;
}

export async function getPendingUserCount() {
  return prisma.user.count({ where: { status: UserStatus.PENDING } });
}
