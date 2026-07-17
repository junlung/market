/**
 * Integration tests for notification emission — proves the DB-enforced
 * dedupe (plain unique on dedupeKey) holds under concurrency, ownership is
 * enforced by the recipient-scoped update, and the lazy awaiting-resolution
 * sweep is idempotent across re-runs.
 *
 * Run via `npm run test:integration` (requires TEST_DATABASE_URL).
 */
import { LedgerEntryType, MarketStatus, NotificationType, UserRole, UserStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { getIsoWeekKey } from "@/lib/allowance";
import { prisma } from "@/lib/prisma";
import { placeBet } from "@/lib/server/bet-service";
import { ensureGlobalLeague, ensureLeagueMembership } from "@/lib/server/league-service";
import { approveProposal, cancelMarket, proposeMarket, resolveMarket } from "@/lib/server/market-service";
import {
  emitNotification,
  getUnreadNotificationCount,
  markNotificationRead,
  sweepAwaitingResolution,
} from "@/lib/server/notification-service";

const enabled = process.env.INTEGRATION_TESTS === "1";

let counter = 0;

async function globalLeagueId() {
  return (await ensureGlobalLeague()).id;
}

async function createUser(balance: number, role: UserRole = UserRole.MEMBER) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `nt-user-${Date.now()}-${counter}@test.local`,
      name: `NtUser${counter}`,
      username: `nt-user-${Date.now()}-${counter}`,
      passwordHash: "not-a-real-hash",
      role,
      status: UserStatus.ACTIVE,
    },
  });

  await ensureLeagueMembership(await globalLeagueId(), user.id);

  if (balance > 0) {
    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        leagueId: await globalLeagueId(),
        type: LedgerEntryType.INITIAL_GRANT,
        amount: balance,
        description: "test grant",
      },
    });
  }

  await prisma.ledgerEntry.create({
    data: {
      userId: user.id,
      leagueId: await globalLeagueId(),
      type: LedgerEntryType.WEEKLY_ALLOWANCE,
      amount: 0,
      allowanceWeek: getIsoWeekKey(new Date()),
      description: "test allowance placeholder",
    },
  });

  return user;
}

async function createOpenMarket(createdById: string, options: { closeTime?: Date } = {}) {
  counter += 1;
  return prisma.market.create({
    data: {
      title: `Notification market ${counter}`,
      leagueId: await globalLeagueId(),
      description: "notification integration test market",
      category: "Test",
      closeTime: options.closeTime ?? new Date(Date.now() + 60 * 60 * 1000),
      resolveTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      resolutionSource: "test",
      status: MarketStatus.OPEN,
      maxStakePerUser: 500,
      rakeBps: 500,
      createdById,
      openedById: createdById,
      openedAt: new Date(),
      outcomes: {
        create: [
          { label: "Yes", color: "green", sortOrder: 0 },
          { label: "No", color: "red", sortOrder: 1 },
        ],
      },
    },
    include: { outcomes: { orderBy: { sortOrder: "asc" } } },
  });
}

describe.skipIf(!enabled)("notifications integration", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.bet.deleteMany();
    await prisma.poolStake.deleteMany();
    await prisma.marketResolution.deleteMany();
    await prisma.appLog.deleteMany();
    await prisma.market.updateMany({ data: { winningOutcomeId: null } });
    await prisma.market.deleteMany();
    await prisma.user.deleteMany();
  });

  it("concurrent emissions with the same dedupeKey produce exactly one row", async () => {
    const user = await createUser(0);
    const input = {
      userId: user.id,
      type: NotificationType.MARKET_RESOLVED,
      title: "dup test",
      href: "/dashboard",
      dedupeKey: `test-dedupe:user:${user.id}`,
    };

    await Promise.all([emitNotification(input), emitNotification(input), emitNotification(input)]);

    const count = await prisma.notification.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("marking someone else's notification read is a silent no-op", async () => {
    const alice = await createUser(0);
    const bob = await createUser(0);
    const created = await emitNotification({
      userId: alice.id,
      type: NotificationType.MEMBER_APPROVED,
      title: "welcome",
      href: "/dashboard",
    });
    expect(created).not.toBeNull();

    await markNotificationRead(bob.id, created!.id);
    expect(await getUnreadNotificationCount(alice.id)).toBe(1);

    await markNotificationRead(alice.id, created!.id);
    expect(await getUnreadNotificationCount(alice.id)).toBe(0);
  });

  it("the awaiting-resolution sweep emits once per admin per market across re-runs", async () => {
    const admin1 = await createUser(0, UserRole.ADMIN);
    const admin2 = await createUser(0, UserRole.ADMIN);
    await createOpenMarket(admin1.id, { closeTime: new Date(Date.now() - 60 * 1000) });

    await sweepAwaitingResolution();
    await sweepAwaitingResolution();
    await Promise.all([sweepAwaitingResolution(), sweepAwaitingResolution()]);

    const rows = await prisma.notification.findMany({
      where: { type: NotificationType.MARKET_AWAITING_RESOLUTION },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.userId))).toEqual(new Set([admin1.id, admin2.id]));

    // a future-close market emits nothing
    await createOpenMarket(admin1.id);
    await sweepAwaitingResolution();
    expect(
      await prisma.notification.count({ where: { type: NotificationType.MARKET_AWAITING_RESOLUTION } }),
    ).toBe(2);
  });

  it("resolveMarket notifies every staker once with their signed profit", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const winner = await createUser(100);
    const loser = await createUser(100);
    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    await placeBet({ userId: winner.id, marketId: market.id, outcomeId: yes.id, amount: 50, skipRateLimit: true });
    await placeBet({ userId: loser.id, marketId: market.id, outcomeId: no.id, amount: 30, skipRateLimit: true });

    await resolveMarket(market.id, admin.id, yes.id, "test");

    const resolvedRows = await prisma.notification.findMany({
      where: { type: NotificationType.MARKET_RESOLVED },
    });
    expect(resolvedRows).toHaveLength(2);

    const winnerRow = resolvedRows.find((row) => row.userId === winner.id);
    const loserRow = resolvedRows.find((row) => row.userId === loser.id);
    expect(winnerRow).toBeDefined();
    expect(loserRow).toBeDefined();

    const winnerMeta = winnerRow!.metadata as { staked: number; payout: number; profit: number };
    const loserMeta = loserRow!.metadata as { staked: number; payout: number; profit: number };
    expect(loserMeta.profit).toBe(-30);
    expect(loserMeta.payout).toBe(0);
    expect(winnerMeta.profit).toBe(winnerMeta.payout - 50);
    expect(winnerMeta.profit).toBeGreaterThan(0);

    // a second resolve throws and adds nothing
    await expect(resolveMarket(market.id, admin.id, yes.id, "test")).rejects.toThrow();
    expect(await prisma.notification.count({ where: { type: NotificationType.MARKET_RESOLVED } })).toBe(2);
  });

  it("cancelMarket notifies each staker with their refund, sharing the settled dedupe space", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const bettor = await createUser(100);
    const market = await createOpenMarket(admin.id);

    await placeBet({
      userId: bettor.id,
      marketId: market.id,
      outcomeId: market.outcomes[0].id,
      amount: 40,
      skipRateLimit: true,
    });

    await cancelMarket(market.id, admin.id, "test cancel");

    const rows = await prisma.notification.findMany({
      where: { userId: bettor.id, dedupeKey: { startsWith: `market-settled:${market.id}` } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(NotificationType.MARKET_CANCELED);
    expect((rows[0].metadata as { refund: number }).refund).toBe(40);
  });

  it("skips self-notifications: proposing and approving your own market", async () => {
    const actingAdmin = await createUser(0, UserRole.ADMIN);
    const otherAdmin = await createUser(0, UserRole.ADMIN);

    const market = await proposeMarket({
      proposerId: actingAdmin.id,
      fields: {
        title: "Self-notification test market?",
        description: "integration test market for notifications",
        category: "misc",
        closeTime: new Date(Date.now() + 60 * 60 * 1000),
        resolveTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        resolutionSource: "test",
      },
      outcomes: [
        { label: "Yes", color: "green" },
        { label: "No", color: "red" },
      ],
    });

    // the other admin hears about it; the proposer does not
    const submitted = await prisma.notification.findMany({
      where: { type: NotificationType.PROPOSAL_SUBMITTED },
    });
    expect(submitted.map((row) => row.userId)).toEqual([otherAdmin.id]);

    // approving your own proposal emits no verdict notification
    await approveProposal(market.id, actingAdmin.id, { openNow: true });
    expect(await prisma.notification.count({ where: { type: NotificationType.PROPOSAL_APPROVED } })).toBe(0);
  });
});
