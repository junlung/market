import {
  AppLogEventType,
  AppLogLevel,
  MarketStatus,
  NotificationType,
  UserRole,
  UserStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/format";
import { marketPath } from "@/lib/leagues";

type EmitInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  href: string;
  dedupeKey?: string;
  metadata?: Prisma.InputJsonValue;
};

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function logEmissionFailure(error: unknown, context: string) {
  try {
    await prisma.appLog.create({
      data: {
        level: AppLogLevel.WARN,
        eventType: AppLogEventType.ADMIN_ACTION,
        message: `Notification emission failed: ${context}`,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      },
    });
  } catch {
    // logging the failure is itself best-effort
  }
}

/**
 * Never throws — notifications are additive and must never fail the parent
 * operation. A P2002 on dedupeKey means this notification was already emitted
 * (expected under re-runs); any other failure is logged to AppLog and swallowed.
 */
export async function emitNotification(input: EmitInput): Promise<{ id: string } | null> {
  try {
    return await prisma.notification.create({
      data: input,
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error) && input.dedupeKey) {
      return null;
    }
    await logEmissionFailure(error, `${input.type} for user ${input.userId}`);
    return null;
  }
}

// lives here rather than member-service: member-service imports this module
// for its own emissions, so parking the query there would create a cycle
async function listAdminIds() {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

type FanOutInput = {
  type: NotificationType;
  title: string;
  body?: string;
  href: string;
  /** the user whose action caused the event — skipped, no self-notification */
  actorId?: string;
  dedupeKeyFor?: (recipientId: string) => string;
  metadata?: Prisma.InputJsonValue;
};

/** Fan-out to an explicit recipient list. Never throws. */
export async function emitToUsers(recipientIds: string[], input: FanOutInput): Promise<void> {
  const recipients = recipientIds.filter((id) => id !== input.actorId);
  for (const userId of recipients) {
    await emitNotification({
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href,
      dedupeKey: input.dedupeKeyFor?.(userId),
      metadata: input.metadata,
    });
  }
}

/** Fan-out to all ACTIVE admins. Never throws. */
export async function emitToAdmins(input: FanOutInput): Promise<void> {
  try {
    await emitToUsers(await listAdminIds(), input);
  } catch (error) {
    await logEmissionFailure(error, `${input.type} admin fan-out`);
  }
}

export async function getUnreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, type: true, title: true, body: true, href: true, readAt: true, createdAt: true },
  });
  // ISO strings so rows pass as plain serializable props into client components
  return rows.map((row) => ({
    ...row,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

// the userId in the where clause IS the ownership check: someone else's id
// matches zero rows and the update is a silent no-op
export async function markNotificationRead(userId: string, notificationId: string) {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

/**
 * Lazy sweep for the one state-derived notification: a market drifting past
 * closeTime unresolved has no event to hook. Runs on admin page loads via
 * getNotificationSnapshot; dedupeKey makes re-runs no-ops. Never throws.
 */
export async function sweepAwaitingResolution(): Promise<void> {
  try {
    const now = new Date();
    const pastClose = await prisma.market.count({
      where: { status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] }, closeTime: { lt: now } },
    });
    if (pastClose === 0) return;

    const markets = await prisma.market.findMany({
      where: { status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] }, closeTime: { lt: now } },
      select: { id: true, title: true, closeTime: true, league: { select: { slug: true, isGlobal: true } } },
    });
    const adminIds = await listAdminIds();

    for (const market of markets) {
      await emitToUsers(adminIds, {
        type: NotificationType.MARKET_AWAITING_RESOLUTION,
        title: `Awaiting resolution: ${market.title}`,
        body: `Closed ${formatRelativeTime(market.closeTime, now)}.`,
        href: marketPath(market.league, market.id),
        dedupeKeyFor: (adminId) => `market-awaiting:${market.id}:user:${adminId}`,
        metadata: { marketId: market.id },
      });
    }
  } catch (error) {
    await logEmissionFailure(error, "awaiting-resolution sweep");
  }
}

/**
 * The nav/page entry point. For admins the sweep runs first — the top nav
 * renders on every signed-in page, making it the same lazy hook point the
 * weekly allowance uses.
 */
export async function getNotificationSnapshot(userId: string, isAdmin: boolean, recentLimit = 8) {
  if (isAdmin) {
    await sweepAwaitingResolution();
  }
  const [unreadCount, recent] = await Promise.all([
    getUnreadNotificationCount(userId),
    listNotifications(userId, recentLimit),
  ]);
  return { unreadCount, recent };
}
