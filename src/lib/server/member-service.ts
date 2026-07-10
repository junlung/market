import { AppLogEventType, AppLogLevel, LedgerEntryType, UserStatus } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";

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
          type: LedgerEntryType.INITIAL_GRANT,
          amount: appConfig.startingBalance,
          description: "Starting balance",
        },
      });
    }
  });

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

export async function listMembers() {
  return prisma.user.findMany({
    include: {
      vouchedBy: { select: { name: true } },
    },
    orderBy: [{ status: "desc" }, { createdAt: "asc" }],
  });
}

export async function getPendingUserCount() {
  return prisma.user.count({ where: { status: UserStatus.PENDING } });
}
