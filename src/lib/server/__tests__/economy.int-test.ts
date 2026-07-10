/**
 * Integration tests against a real Postgres — these prove the concurrency
 * claims that unit tests can't: Serializable transactions actually prevent
 * double-spends, cap busts, and resolve-vs-bet races.
 *
 * Run via `npm run test:integration` (requires TEST_DATABASE_URL).
 */
import { BetSide, LedgerEntryType, MarketStatus, UserRole, UserStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { getIsoWeekKey } from "@/lib/allowance";
import { prisma } from "@/lib/prisma";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { placeBet } from "@/lib/server/bet-service";
import { cancelMarket, resolveMarket } from "@/lib/server/market-service";

const enabled = process.env.INTEGRATION_TESTS === "1";

let counter = 0;

async function createUser(balance: number, role: UserRole = UserRole.MEMBER) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `it-user-${Date.now()}-${counter}@test.local`,
      name: `ItUser${counter}`,
      passwordHash: "not-a-real-hash",
      role,
      status: UserStatus.ACTIVE,
    },
  });

  if (balance > 0) {
    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        type: LedgerEntryType.INITIAL_GRANT,
        amount: balance,
        description: "test grant",
      },
    });
  }

  // pre-fill this week's allowance slot with a zero-value row so the lazy
  // auto-credit inside placeBet can't shift the balance arithmetic mid-test
  await prisma.ledgerEntry.create({
    data: {
      userId: user.id,
      type: LedgerEntryType.WEEKLY_ALLOWANCE,
      amount: 0,
      allowanceWeek: getIsoWeekKey(new Date()),
      description: "test allowance placeholder",
    },
  });

  return user;
}

async function createOpenMarket(createdById: string, maxStakePerUser = 500, rakeBps = 500) {
  counter += 1;
  return prisma.market.create({
    data: {
      title: `Integration market ${counter}`,
      description: "integration test market",
      category: "Test",
      closeTime: new Date(Date.now() + 60 * 60 * 1000),
      resolveTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      resolutionSource: "test",
      status: MarketStatus.OPEN,
      maxStakePerUser,
      rakeBps,
      createdById,
      openedById: createdById,
      openedAt: new Date(),
    },
  });
}

async function userBalance(userId: string) {
  const result = await prisma.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
  return result._sum.amount ?? 0;
}

function bet(userId: string, marketId: string, side: BetSide, amount: number) {
  return placeBet({ userId, marketId, side, amount, skipRateLimit: true });
}

describe.skipIf(!enabled)("economy integration", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.bet.deleteMany();
    await prisma.poolStake.deleteMany();
    await prisma.marketResolution.deleteMany();
    await prisma.appLog.deleteMany();
    await prisma.market.deleteMany();
    await prisma.user.deleteMany();
  });

  it("prevents a concurrent double-spend from going negative", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(100);
    const market = await createOpenMarket(admin.id);

    const results = await Promise.allSettled([
      bet(user.id, market.id, BetSide.YES, 80),
      bet(user.id, market.id, BetSide.YES, 80),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await userBalance(user.id)).toBe(20);
  });

  it("prevents concurrent top-ups from busting the per-market cap", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(500);
    const market = await createOpenMarket(admin.id, 100);

    const results = await Promise.allSettled([
      bet(user.id, market.id, BetSide.YES, 60),
      bet(user.id, market.id, BetSide.NO, 60),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const stake = await prisma.poolStake.findUnique({
      where: { userId_marketId: { userId: user.id, marketId: market.id } },
    });
    expect((stake?.yesStake ?? 0) + (stake?.noStake ?? 0)).toBeLessThanOrEqual(100);
  });

  it("credits the weekly allowance exactly once under concurrency", async () => {
    const user = await createUser(0);
    // remove the placeholder so this test exercises the real race
    await prisma.ledgerEntry.deleteMany({
      where: { userId: user.id, type: LedgerEntryType.WEEKLY_ALLOWANCE },
    });

    await Promise.all(Array.from({ length: 6 }, () => ensureWeeklyAllowance(user.id)));

    const rows = await prisma.ledgerEntry.findMany({
      where: { userId: user.id, type: LedgerEntryType.WEEKLY_ALLOWANCE },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].allowanceWeek).toBe(getIsoWeekKey(new Date()));
  });

  it("settles a market with exact conservation and winners never below stake", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);
    const casey = await createUser(500);
    const market = await createOpenMarket(admin.id);

    await bet(alex.id, market.id, BetSide.YES, 121);
    await bet(blair.id, market.id, BetSide.NO, 200);
    await bet(casey.id, market.id, BetSide.YES, 32);

    await resolveMarket(market.id, admin.id, "YES", "test", "integration");

    const resolution = await prisma.marketResolution.findUniqueOrThrow({
      where: { marketId: market.id },
    });
    expect(resolution.yesPoolFinal + resolution.noPoolFinal).toBe(
      resolution.totalPaidOut + resolution.rakeAmount + resolution.dustAmount,
    );

    // market-scoped ledger sums to exactly the burned amount (stakes negative, payouts positive)
    const marketLedger = await prisma.ledgerEntry.aggregate({
      where: { marketId: market.id },
      _sum: { amount: true },
    });
    expect(marketLedger._sum.amount).toBe(-(resolution.rakeAmount + resolution.dustAmount));

    // winners never receive less than their stake back
    expect(await userBalance(alex.id)).toBeGreaterThanOrEqual(500);
    expect(await userBalance(casey.id)).toBeGreaterThanOrEqual(500);
    expect(await userBalance(blair.id)).toBe(300);
  });

  it("fences bets against a concurrent resolution — no point is both spent and unpaid", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);
    const casey = await createUser(500);
    const market = await createOpenMarket(admin.id);

    await bet(alex.id, market.id, BetSide.YES, 100);
    await bet(blair.id, market.id, BetSide.NO, 100);

    const [resolveResult, betResult] = await Promise.allSettled([
      resolveMarket(market.id, admin.id, "YES", "test"),
      bet(casey.id, market.id, BetSide.NO, 50),
    ]);

    expect(resolveResult.status).toBe("fulfilled");

    const resolution = await prisma.marketResolution.findUniqueOrThrow({
      where: { marketId: market.id },
    });

    if (betResult.status === "fulfilled") {
      // the bet won the race — it must be inside the settled pools
      expect(resolution.noPoolFinal).toBe(150);
    } else {
      // the bet lost the race — it must have cost casey nothing
      expect(await userBalance(casey.id)).toBe(500);
      expect(resolution.noPoolFinal).toBe(100);
    }

    const marketLedger = await prisma.ledgerEntry.aggregate({
      where: { marketId: market.id },
      _sum: { amount: true },
    });
    expect(marketLedger._sum.amount).toBe(-(resolution.rakeAmount + resolution.dustAmount));
  });

  it("refunds every stake in full when a market is canceled", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);
    const market = await createOpenMarket(admin.id);

    await bet(alex.id, market.id, BetSide.YES, 120);
    await bet(blair.id, market.id, BetSide.NO, 75);
    await cancelMarket(market.id, admin.id, "integration test cancel");

    expect(await userBalance(alex.id)).toBe(500);
    expect(await userBalance(blair.id)).toBe(500);

    const resolution = await prisma.marketResolution.findUniqueOrThrow({
      where: { marketId: market.id },
    });
    expect(resolution.rakeAmount).toBe(0);
    expect(resolution.totalPaidOut).toBe(195);
  });

  it("rejects bets after close time and beyond balance", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(50);
    const market = await createOpenMarket(admin.id);

    await expect(bet(user.id, market.id, BetSide.YES, 100)).rejects.toThrow(/balance/i);

    await prisma.market.update({
      where: { id: market.id },
      data: { closeTime: new Date(Date.now() - 1000) },
    });
    await expect(bet(user.id, market.id, BetSide.YES, 10)).rejects.toThrow(/close/i);
  });
});
