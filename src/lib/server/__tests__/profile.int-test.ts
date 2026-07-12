/**
 * Integration tests for the profile + inventory services against a real
 * Postgres: career stats derived from actual settlements, and grant-key
 * idempotency under the real unique constraint.
 *
 * Run via `npm run test:integration` (requires TEST_DATABASE_URL).
 */
import { ItemKind, ItemSource, MarketStatus, LedgerEntryType, UserRole, UserStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { getIsoWeekKey } from "@/lib/allowance";
import { prisma } from "@/lib/prisma";
import { placeBet } from "@/lib/server/bet-service";
import { grantItem, listUserItems } from "@/lib/server/item-service";
import { ensureGlobalLeague } from "@/lib/server/league-service";
import { resolveMarket } from "@/lib/server/market-service";
import { getProfileByUsername } from "@/lib/server/profile-service";

const enabled = process.env.INTEGRATION_TESTS === "1";

let counter = 0;

async function globalLeagueId() {
  return (await ensureGlobalLeague()).id;
}

async function createUser(
  balance: number,
  role: UserRole = UserRole.MEMBER,
  status: UserStatus = UserStatus.ACTIVE,
) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `profile-user-${Date.now()}-${counter}@test.local`,
      name: `ProfileUser${counter}`,
      username: `profile-${Date.now() % 1_000_000}-${counter}`,
      passwordHash: "not-a-real-hash",
      role,
      status,
    },
  });

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

  // block the lazy allowance from shifting balances mid-test (same trick as
  // the economy suite)
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

async function createOpenMarket(createdById: string) {
  counter += 1;
  return prisma.market.create({
    data: {
      title: `Profile market ${counter}`,
      leagueId: await globalLeagueId(),
      description: "profile integration test market",
      category: "Test",
      closeTime: new Date(Date.now() + 60 * 60 * 1000),
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

async function createItem(kind: ItemKind = ItemKind.TROPHY) {
  counter += 1;
  return prisma.item.create({
    data: {
      slug: `test-item-${Date.now()}-${counter}`,
      name: `Test Item ${counter}`,
      description: "integration test item",
      kind,
      style: { emoji: "🏆" },
    },
  });
}

describe.skipIf(!enabled)("profile + inventory integration", () => {
  beforeEach(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.comment.deleteMany();
    await prisma.bet.deleteMany();
    await prisma.poolStake.deleteMany();
    await prisma.marketResolution.deleteMany();
    await prisma.appLog.deleteMany();
    await prisma.market.updateMany({ data: { winningOutcomeId: null } });
    await prisma.market.deleteMany();
    await prisma.userItem.deleteMany();
    await prisma.item.deleteMany();
    await prisma.user.deleteMany();
  });

  it("returns null for unknown handles and non-active accounts", async () => {
    expect(await getProfileByUsername("nobody-here")).toBeNull();

    const pending = await createUser(0, UserRole.MEMBER, UserStatus.PENDING);
    expect(await getProfileByUsername(pending.username)).toBeNull();
  });

  it("computes career stats from a real settlement", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alice = await createUser(500);
    const bob = await createUser(500);
    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    await placeBet({ userId: alice.id, marketId: market.id, outcomeId: yes.id, amount: 100, skipRateLimit: true });
    await placeBet({ userId: bob.id, marketId: market.id, outcomeId: no.id, amount: 100, skipRateLimit: true });
    await resolveMarket(market.id, admin.id, yes.id, "test source");

    // losing pool 100, rake 5% = 5 → alice: stake back + floor(100*95/100) = 195
    const aliceProfile = await getProfileByUsername(alice.username);
    expect(aliceProfile).not.toBeNull();
    expect(aliceProfile!.stats.netProfit).toBe(95);
    expect(aliceProfile!.stats.marketsPlayed).toBe(1);
    expect(aliceProfile!.stats.marketsWon).toBe(1);
    expect(aliceProfile!.stats.winRate).toBe(1);
    expect(aliceProfile!.stats.biggestPayout).toBe(195);
    expect(aliceProfile!.recentResults).toHaveLength(1);
    expect(aliceProfile!.recentResults[0].net).toBe(95);
    expect(aliceProfile!.recentResults[0].market.id).toBe(market.id);

    const bobProfile = await getProfileByUsername(bob.username);
    expect(bobProfile!.stats.netProfit).toBe(-100);
    expect(bobProfile!.stats.marketsWon).toBe(0);
    expect(bobProfile!.stats.winRate).toBe(0);
    expect(bobProfile!.recentResults[0].net).toBe(-100);
  });

  it("counts open stakes as at-risk, not as losses", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alice = await createUser(500);
    const market = await createOpenMarket(admin.id);

    await placeBet({
      userId: alice.id,
      marketId: market.id,
      outcomeId: market.outcomes[0].id,
      amount: 150,
      skipRateLimit: true,
    });

    const profile = await getProfileByUsername(alice.username);
    // balance 350 + at-risk 150 − grants 500 = 0 profit while the market is open
    expect(profile!.stats.netProfit).toBe(0);
    expect(profile!.stats.marketsPlayed).toBe(0);
    expect(profile!.recentResults).toHaveLength(0);
  });

  it("grants items idempotently by grantKey and lists them on the profile", async () => {
    const alice = await createUser(0);
    const item = await createItem();
    const grantKey = `season:test:user:${alice.id}`;

    const first = await grantItem({
      userId: alice.id,
      itemId: item.id,
      source: ItemSource.SEASON_TROPHY,
      provenance: { league: "Global League", placement: 1 },
      grantKey,
    });
    const second = await grantItem({
      userId: alice.id,
      itemId: item.id,
      source: ItemSource.SEASON_TROPHY,
      provenance: { league: "Global League", placement: 1 },
      grantKey,
    });

    expect(second.id).toBe(first.id);
    expect(await prisma.userItem.count()).toBe(1);

    const inventory = await listUserItems(alice.id);
    expect(inventory).toHaveLength(1);
    expect(inventory[0].item.slug).toBe(item.slug);

    const profile = await getProfileByUsername(alice.username);
    expect(profile!.trophyCase).toHaveLength(1);

    // no grantKey → duplicates are allowed (distinct provenance)
    await grantItem({ userId: alice.id, itemId: item.id, source: ItemSource.ADMIN_GRANT });
    expect(await prisma.userItem.count()).toBe(2);
  });
});
