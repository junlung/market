/**
 * Integration tests against a real Postgres — these prove the concurrency
 * claims that unit tests can't: Serializable transactions actually prevent
 * double-spends, cap busts, and resolve-vs-bet races.
 *
 * Run via `npm run test:integration` (requires TEST_DATABASE_URL).
 */
import { LedgerEntryType, MarketStatus, UserRole, UserStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { getIsoWeekKey } from "@/lib/allowance";
import { prisma } from "@/lib/prisma";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { placeBet } from "@/lib/server/bet-service";
import { cancelMarket, resolveMarket } from "@/lib/server/market-service";
import { approveUser, rejectUser } from "@/lib/server/member-service";

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

const BINARY = [
  { label: "Yes", color: "green" },
  { label: "No", color: "red" },
];

const TRIPLE = [
  { label: "Arsenal", color: "red" },
  { label: "Draw", color: "amber" },
  { label: "Chelsea", color: "blue" },
];

async function createOpenMarket(
  createdById: string,
  options: { maxStakePerUser?: number; rakeBps?: number; outcomes?: Array<{ label: string; color: string }> } = {},
) {
  counter += 1;
  const market = await prisma.market.create({
    data: {
      title: `Integration market ${counter}`,
      description: "integration test market",
      category: "Test",
      closeTime: new Date(Date.now() + 60 * 60 * 1000),
      resolveTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      resolutionSource: "test",
      status: MarketStatus.OPEN,
      maxStakePerUser: options.maxStakePerUser ?? 500,
      rakeBps: options.rakeBps ?? 500,
      createdById,
      openedById: createdById,
      openedAt: new Date(),
      outcomes: {
        create: (options.outcomes ?? BINARY).map((outcome, index) => ({
          label: outcome.label,
          color: outcome.color,
          sortOrder: index,
        })),
      },
    },
    include: { outcomes: { orderBy: { sortOrder: "asc" } } },
  });
  return market;
}

async function userBalance(userId: string) {
  const result = await prisma.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
  return result._sum.amount ?? 0;
}

function bet(userId: string, marketId: string, outcomeId: string, amount: number) {
  return placeBet({ userId, marketId, outcomeId, amount, skipRateLimit: true });
}

/** Σ poolFinal must equal totalPaidOut + rake + dust — the typed-int audit. */
async function expectConservation(marketId: string) {
  const resolution = await prisma.marketResolution.findUniqueOrThrow({ where: { marketId } });
  const outcomes = await prisma.outcome.findMany({ where: { marketId } });
  const poolFinalSum = outcomes.reduce((sum, outcome) => sum + (outcome.poolFinal ?? 0), 0);
  expect(poolFinalSum).toBe(
    resolution.totalPaidOut + resolution.rakeAmount + resolution.dustAmount,
  );

  // market-scoped ledger sums to exactly the burned amount (stakes negative, payouts positive)
  const marketLedger = await prisma.ledgerEntry.aggregate({
    where: { marketId },
    _sum: { amount: true },
  });
  expect(marketLedger._sum.amount).toBe(0 - resolution.rakeAmount - resolution.dustAmount);

  return resolution;
}

describe.skipIf(!enabled)("economy integration", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.bet.deleteMany();
    await prisma.poolStake.deleteMany();
    await prisma.marketResolution.deleteMany();
    await prisma.appLog.deleteMany();
    await prisma.market.updateMany({ data: { winningOutcomeId: null } });
    await prisma.market.deleteMany();
    await prisma.user.deleteMany();
  });

  it("prevents a concurrent double-spend from going negative", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(100);
    const market = await createOpenMarket(admin.id);
    const yes = market.outcomes[0];

    const results = await Promise.allSettled([
      bet(user.id, market.id, yes.id, 80),
      bet(user.id, market.id, yes.id, 80),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await userBalance(user.id)).toBe(20);
  });

  it("prevents concurrent top-ups across outcome rows from busting the per-market cap", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(500);
    const market = await createOpenMarket(admin.id, { maxStakePerUser: 100, outcomes: TRIPLE });

    // the cap is a sum over per-outcome rows — the race must still lose
    const results = await Promise.allSettled([
      bet(user.id, market.id, market.outcomes[0].id, 60),
      bet(user.id, market.id, market.outcomes[2].id, 60),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const stakes = await prisma.poolStake.findMany({
      where: { userId: user.id, marketId: market.id },
    });
    expect(stakes.reduce((sum, stake) => sum + stake.amount, 0)).toBeLessThanOrEqual(100);
  });

  it("rejects an outcomeId from another market — the silent-refund exploit", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(500);
    const market = await createOpenMarket(admin.id);
    const other = await createOpenMarket(admin.id);

    await expect(bet(user.id, market.id, other.outcomes[0].id, 50)).rejects.toThrow(/belong/i);

    // nothing moved: no bet, no stake, no ledger entry, pools untouched
    expect(await prisma.bet.count({ where: { marketId: market.id } })).toBe(0);
    expect(await userBalance(user.id)).toBe(500);
    const outcomes = await prisma.outcome.findMany({ where: { marketId: other.id } });
    expect(outcomes.every((outcome) => outcome.pool === 0)).toBe(true);
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

  it("settles a binary market with exact conservation and winners never below stake", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);
    const casey = await createUser(500);
    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    await bet(alex.id, market.id, yes.id, 121);
    await bet(blair.id, market.id, no.id, 200);
    await bet(casey.id, market.id, yes.id, 32);

    await resolveMarket(market.id, admin.id, yes.id, "test", "integration");

    const resolution = await expectConservation(market.id);
    expect(resolution.winningOutcomeId).toBe(yes.id);

    const updated = await prisma.market.findUniqueOrThrow({ where: { id: market.id } });
    expect(updated.winningOutcomeId).toBe(yes.id);

    // winners never receive less than their stake back
    expect(await userBalance(alex.id)).toBeGreaterThanOrEqual(500);
    expect(await userBalance(casey.id)).toBeGreaterThanOrEqual(500);
    expect(await userBalance(blair.id)).toBe(300);
  });

  it("settles a 3-outcome market where a straddling user gets one payout row", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const hedger = await createUser(500);
    const other = await createUser(500);
    const market = await createOpenMarket(admin.id, { outcomes: TRIPLE });
    const [arsenal, draw, chelsea] = market.outcomes;

    await bet(hedger.id, market.id, arsenal.id, 100);
    await bet(hedger.id, market.id, draw.id, 50);
    await bet(other.id, market.id, chelsea.id, 150);

    await resolveMarket(market.id, admin.id, arsenal.id, "test");

    await expectConservation(market.id);

    // W = 100, L = 200, rake = 10 → hedger nets 100 + 190 = 290 in ONE payout
    const payouts = await prisma.ledgerEntry.findMany({
      where: { marketId: market.id, type: LedgerEntryType.MARKET_PAYOUT },
    });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].userId).toBe(hedger.id);
    expect(payouts[0].amount).toBe(290);
    expect(await userBalance(hedger.id)).toBe(500 - 150 + 290);
    expect(await userBalance(other.id)).toBe(350);
  });

  it("refunds everyone when nobody backed the winning outcome", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);
    const market = await createOpenMarket(admin.id, { outcomes: TRIPLE });
    const [arsenal, draw, chelsea] = market.outcomes;

    await bet(alex.id, market.id, arsenal.id, 200);
    await bet(blair.id, market.id, chelsea.id, 100);

    // the unbacked dark horse wins → REFUND_ALL, no rake
    await resolveMarket(market.id, admin.id, draw.id, "test");

    const resolution = await expectConservation(market.id);
    expect(resolution.rakeAmount).toBe(0);
    expect(await userBalance(alex.id)).toBe(500);
    expect(await userBalance(blair.id)).toBe(500);
  });

  it("fences bets against a concurrent resolution — no point is both spent and unpaid", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);
    const casey = await createUser(500);
    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    await bet(alex.id, market.id, yes.id, 100);
    await bet(blair.id, market.id, no.id, 100);

    const [resolveResult, betResult] = await Promise.allSettled([
      resolveMarket(market.id, admin.id, yes.id, "test"),
      bet(casey.id, market.id, no.id, 50),
    ]);

    expect(resolveResult.status).toBe("fulfilled");

    const noOutcome = await prisma.outcome.findUniqueOrThrow({ where: { id: no.id } });

    if (betResult.status === "fulfilled") {
      // the bet won the race — it must be inside the settled pools
      expect(noOutcome.poolFinal).toBe(150);
    } else {
      // the bet lost the race — it must have cost casey nothing
      expect(await userBalance(casey.id)).toBe(500);
      expect(noOutcome.poolFinal).toBe(100);
    }

    await expectConservation(market.id);
  });

  it("refunds every stake in full when a market is canceled", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);
    const market = await createOpenMarket(admin.id, { outcomes: TRIPLE });

    await bet(alex.id, market.id, market.outcomes[0].id, 120);
    await bet(blair.id, market.id, market.outcomes[1].id, 75);
    await cancelMarket(market.id, admin.id, "integration test cancel");

    expect(await userBalance(alex.id)).toBe(500);
    expect(await userBalance(blair.id)).toBe(500);

    const resolution = await prisma.marketResolution.findUniqueOrThrow({
      where: { marketId: market.id },
    });
    expect(resolution.winningOutcomeId).toBeNull();
    expect(resolution.rakeAmount).toBe(0);
    expect(resolution.totalPaidOut).toBe(195);
  });

  it("reject → approve grants the starting balance exactly once", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const applicant = await prisma.user.create({
      data: {
        email: `applicant-${Date.now()}@test.local`,
        name: "Applicant",
        passwordHash: "not-a-real-hash",
        status: UserStatus.PENDING,
      },
    });

    await rejectUser(applicant.id, admin.id); // reason now optional
    let user = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(user.status).toBe(UserStatus.REJECTED);
    expect(user.reviewNote).toBe("Rejected by admin");
    expect(await userBalance(applicant.id)).toBe(0);

    // admin changes their mind: rejected accounts are directly approvable
    await approveUser(applicant.id, admin.id);
    user = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(user.status).toBe(UserStatus.ACTIVE);
    expect(await userBalance(applicant.id)).toBe(500);

    // double-approval attempts can't double-grant
    await expect(approveUser(applicant.id, admin.id)).rejects.toThrow();
    expect(await userBalance(applicant.id)).toBe(500);
  });

  it("rejects bets after close time and beyond balance", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(50);
    const market = await createOpenMarket(admin.id);
    const yes = market.outcomes[0];

    await expect(bet(user.id, market.id, yes.id, 100)).rejects.toThrow(/balance/i);

    await prisma.market.update({
      where: { id: market.id },
      data: { closeTime: new Date(Date.now() - 1000) },
    });
    await expect(bet(user.id, market.id, yes.id, 10)).rejects.toThrow(/close/i);
  });
});
