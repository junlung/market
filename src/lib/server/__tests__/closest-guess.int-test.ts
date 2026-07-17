/**
 * Integration tests for CLOSEST_GUESS markets against a real Postgres: the
 * ante write path (charged once, date claims race-safe), podium settlement
 * with conservation, cancel refunds, and the guards that keep the two market
 * kinds from crossing.
 *
 * Run via `npm run test:integration` (requires TEST_DATABASE_URL).
 */
import { LedgerEntryType, MarketKind, MarketStatus, UserRole, UserStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { getIsoWeekKey } from "@/lib/allowance";
import { prisma } from "@/lib/prisma";
import { placeGuess } from "@/lib/server/guess-service";
import { ensureGlobalLeague, ensureLeagueMembership } from "@/lib/server/league-service";
import {
  cancelMarket,
  createMarket,
  previewGuessSettlement,
  resolveClosestGuessMarket,
  resolveMarket,
} from "@/lib/server/market-service";

const enabled = process.env.INTEGRATION_TESTS === "1";

let counter = 0;

async function globalLeagueId() {
  return (await ensureGlobalLeague()).id;
}

async function createUser(balance: number, role: UserRole = UserRole.MEMBER) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `cg-user-${Date.now()}-${counter}@test.local`,
      name: `CgUser${counter}`,
      username: `cg-user-${Date.now() % 1_000_000}-${counter}`,
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

async function createGuessMarket(actorId: string, ante = 100) {
  counter += 1;
  return createMarket({
    actorId,
    kind: MarketKind.CLOSEST_GUESS,
    anteAmount: ante,
    outcomes: [],
    openNow: true,
    fields: {
      title: `When does the thing happen ${counter}?`,
      description: "Closest date takes the pot in this integration test.",
      category: "misc",
      closeTime: new Date(Date.now() + 60 * 60 * 1000),
      resolveTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      resolutionSource: "test",
    },
  });
}

async function userBalance(userId: string) {
  const result = await prisma.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
  return result._sum.amount ?? 0;
}

const day = (offset: number) => new Date(Date.UTC(2026, 7, 15 + offset));

describe.skipIf(!enabled)("closest-guess markets", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.bet.deleteMany();
    await prisma.poolStake.deleteMany();
    await prisma.guess.deleteMany();
    await prisma.marketResolution.deleteMany();
    await prisma.appLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.gemLedgerEntry.deleteMany();
    await prisma.market.updateMany({ data: { winningOutcomeId: null } });
    await prisma.market.deleteMany();
    await prisma.userItem.deleteMany();
    await prisma.item.deleteMany();
    await prisma.season.deleteMany();
    await prisma.leagueInvite.deleteMany();
    await prisma.leagueMembership.deleteMany();
    await prisma.league.deleteMany({ where: { isGlobal: false } });
    await prisma.user.deleteMany();
  });

  it("charges the ante once, keeps dates exclusive, and lets a guess move for free", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(300);
    const blair = await createUser(300);
    const market = await createGuessMarket(admin.id, 100);

    await placeGuess({ userId: alex.id, marketId: market.id, value: day(1), skipRateLimit: true });
    expect(await userBalance(alex.id)).toBe(200);

    // blair can't take alex's date
    await expect(
      placeGuess({ userId: blair.id, marketId: market.id, value: day(1), skipRateLimit: true }),
    ).rejects.toThrow(/already claimed/i);

    await placeGuess({ userId: blair.id, marketId: market.id, value: day(2), skipRateLimit: true });
    expect(await userBalance(blair.id)).toBe(200);

    // moving is free — still one guess, no second ante
    await placeGuess({ userId: alex.id, marketId: market.id, value: day(-3), skipRateLimit: true });
    expect(await userBalance(alex.id)).toBe(200);
    expect(await prisma.guess.count({ where: { marketId: market.id } })).toBe(2);

    // concurrent duplicate claims collapse to one owner
    const casey = await createUser(300);
    const dana = await createUser(300);
    const results = await Promise.allSettled([
      placeGuess({ userId: casey.id, marketId: market.id, value: day(5), skipRateLimit: true }),
      placeGuess({ userId: dana.id, marketId: market.id, value: day(5), skipRateLimit: true }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.guess.count({ where: { marketId: market.id, value: day(5) } })).toBe(1);
  });

  it("settles the podium 60/25/15 with conservation, frozen ranks, and achievements", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const users = await Promise.all([
      createUser(200),
      createUser(200),
      createUser(200),
      createUser(200),
    ]);
    const [first, second, third, fourth] = users;
    const market = await createGuessMarket(admin.id, 100);

    await placeGuess({ userId: first.id, marketId: market.id, value: day(1), skipRateLimit: true });
    await placeGuess({ userId: second.id, marketId: market.id, value: day(3), skipRateLimit: true });
    await placeGuess({ userId: third.id, marketId: market.id, value: day(-6), skipRateLimit: true });
    await placeGuess({ userId: fourth.id, marketId: market.id, value: day(20), skipRateLimit: true });

    // the preview agrees with the settlement before anything is written
    const preview = await previewGuessSettlement(market.id, day(0));
    expect(preview.pot).toBe(400);
    expect(preview.rows[0]).toMatchObject({ userId: first.id, rank: 1, payout: 240 });

    await resolveClosestGuessMarket(market.id, admin.id, day(0), "test");

    // pot 400 → 240 / 100 / 60
    expect(await userBalance(first.id)).toBe(100 + 240);
    expect(await userBalance(second.id)).toBe(100 + 100);
    expect(await userBalance(third.id)).toBe(100 + 60);
    expect(await userBalance(fourth.id)).toBe(100);

    const resolution = await prisma.marketResolution.findUniqueOrThrow({
      where: { marketId: market.id },
    });
    expect(resolution.actualValue?.getTime()).toBe(day(0).getTime());
    expect(resolution.winningPool).toBe(400);
    expect(resolution.totalPaidOut + resolution.dustAmount).toBe(400);
    expect(resolution.rakeAmount).toBe(0);
    expect(resolution.gemsMinted).toBe(0);

    const guesses = await prisma.guess.findMany({ where: { marketId: market.id } });
    expect(guesses.find((g) => g.userId === first.id)).toMatchObject({ finalRank: 1, payout: 240 });
    expect(guesses.find((g) => g.userId === fourth.id)).toMatchObject({ finalRank: 4, payout: 0 });

    // rank 1 is the win: first-win achievement mints for the winner only
    const grants = await prisma.gemLedgerEntry.findMany({
      where: { achievementKey: "first-win" },
      select: { userId: true },
    });
    expect(grants.map((g) => g.userId)).toEqual([first.id]);

    // everyone got a settlement notification
    expect(
      await prisma.notification.count({
        where: { dedupeKey: { startsWith: `market-settled:${market.id}` } },
      }),
    ).toBe(4);
  });

  it("cancel refunds every ante in full", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(150);
    const blair = await createUser(150);
    const market = await createGuessMarket(admin.id, 150);

    await placeGuess({ userId: alex.id, marketId: market.id, value: day(1), skipRateLimit: true });
    await placeGuess({ userId: blair.id, marketId: market.id, value: day(2), skipRateLimit: true });
    expect(await userBalance(alex.id)).toBe(0);

    await cancelMarket(market.id, admin.id, "called off");

    expect(await userBalance(alex.id)).toBe(150);
    expect(await userBalance(blair.id)).toBe(150);
    const market2 = await prisma.market.findUniqueOrThrow({ where: { id: market.id } });
    expect(market2.status).toBe(MarketStatus.CANCELED);
  });

  it("keeps the two market kinds apart and enforces ante affordability", async () => {
    const admin = await createUser(500, UserRole.ADMIN);
    const poor = await createUser(50);
    const market = await createGuessMarket(admin.id, 100);

    // bets don't work on guess markets (no outcome can match), guesses don't
    // work on parimutuel markets, and outcome-resolution is refused
    await expect(
      placeGuess({ userId: poor.id, marketId: market.id, value: day(1), skipRateLimit: true }),
    ).rejects.toThrow(/insufficient/i);
    await expect(
      resolveMarket(market.id, admin.id, "not-an-outcome", "test"),
    ).rejects.toThrow(/closest-guess|outcome/i);

    const parimutuel = await createMarket({
      actorId: admin.id,
      openNow: true,
      outcomes: [
        { label: "Yes", color: "green" },
        { label: "No", color: "red" },
      ],
      fields: {
        title: "A normal market for contrast",
        description: "Parimutuel — guesses must bounce off this one.",
        category: "misc",
        closeTime: new Date(Date.now() + 60 * 60 * 1000),
        resolveTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        resolutionSource: "test",
      },
    });
    await expect(
      placeGuess({ userId: admin.id, marketId: parimutuel.id, value: day(1), skipRateLimit: true }),
    ).rejects.toThrow(/bets, not guesses/i);
    await expect(
      resolveClosestGuessMarket(parimutuel.id, admin.id, day(0), "test"),
    ).rejects.toThrow(/closest-guess/i);

    // creating a guess market without an ante is refused
    await expect(createGuessMarket(admin.id, 0)).rejects.toThrow(/ante/i);
  });
});
