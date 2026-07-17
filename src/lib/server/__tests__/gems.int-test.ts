/**
 * Integration tests for Phase 3 (gems economy) against a real Postgres:
 * rake→gem conversion at settlement, achievement grants, placement gems,
 * store purchases, equip slot exclusivity, and the launch backfill.
 *
 * Run via `npm run test:integration` (requires TEST_DATABASE_URL).
 */
import {
  EquipSlot,
  GemLedgerEntryType,
  ItemKind,
  ItemSource,
  LedgerEntryType,
  MarketStatus,
  SeasonStatus,
  UserRole,
  UserStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { getIsoWeekKey } from "@/lib/allowance";
import { getMonthWindow } from "@/lib/leagues";
import { prisma } from "@/lib/prisma";
import {
  evaluateUserAchievements,
  getAchievementProgress,
  getShowcasedAchievements,
  getUserResolvedHistory,
  setShowcasedAchievements,
} from "@/lib/server/achievement-service";
import { placeBet } from "@/lib/server/bet-service";
import {
  backfillAchievements,
  backfillPlacements,
  backfillRakeConversions,
  backfillStartingGrants,
} from "@/lib/server/backfill-gems";
import { adjustGems, getGemBalance } from "@/lib/server/gem-service";
import { approveUser } from "@/lib/server/member-service";
import {
  equipItem,
  getEquippedCosmetics,
  grantItem,
  unequipSlot,
} from "@/lib/server/item-service";
import { createLeague, ensureGlobalLeague, ensureLeagueMembership, joinLeagueByCode } from "@/lib/server/league-service";
import { cancelMarket, createMarket, resolveMarket } from "@/lib/server/market-service";
import { createSeason, finalizeDueSeasons } from "@/lib/server/season-service";
import { purchaseItem } from "@/lib/server/store-service";

const enabled = process.env.INTEGRATION_TESTS === "1";

let counter = 0;

async function globalLeagueId() {
  return (await ensureGlobalLeague()).id;
}

async function createUser(balance: number, role: UserRole = UserRole.MEMBER) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `gem-user-${Date.now()}-${counter}@test.local`,
      name: `GemUser${counter}`,
      username: `gem-user-${Date.now() % 1_000_000}-${counter}`,
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

  // block the lazy allowance from shifting balances mid-test
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

async function createOpenMarket(
  createdById: string,
  options: { rakeBps?: number; outcomes?: Array<{ label: string; color: string }> } = {},
) {
  counter += 1;
  return prisma.market.create({
    data: {
      title: `Gems market ${counter}`,
      leagueId: await globalLeagueId(),
      description: "gems integration test market",
      category: "Test",
      closeTime: new Date(Date.now() + 60 * 60 * 1000),
      resolveTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
      resolutionSource: "test",
      status: MarketStatus.OPEN,
      maxStakePerUser: 500,
      rakeBps: options.rakeBps ?? 500,
      createdById,
      openedById: createdById,
      openedAt: new Date(),
      outcomes: {
        create: (
          options.outcomes ?? [
            { label: "Yes", color: "green" },
            { label: "No", color: "red" },
          ]
        ).map((outcome, index) => ({ label: outcome.label, color: outcome.color, sortOrder: index })),
      },
    },
    include: { outcomes: { orderBy: { sortOrder: "asc" } } },
  });
}

function bet(userId: string, marketId: string, outcomeId: string, amount: number) {
  return placeBet({ userId, marketId, outcomeId, amount, skipRateLimit: true });
}

/** Rake-conversion gems only — achievement grants ride along on resolves. */
async function rakeGems(userId: string) {
  const result = await prisma.gemLedgerEntry.aggregate({
    where: { userId, type: GemLedgerEntryType.RAKE_CONVERSION },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

describe.skipIf(!enabled)("gems integration", () => {
  beforeEach(async () => {
    await prisma.gemLedgerEntry.deleteMany();
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
    await prisma.season.deleteMany();
    await prisma.leagueMembership.deleteMany();
    await prisma.league.deleteMany({ where: { isGlobal: false } });
    await prisma.user.deleteMany();
  });

  it("mints rake as gems pro-rata to winners at settlement", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const casey = await createUser(500);
    const loser = await createUser(500);
    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    await bet(alex.id, market.id, yes.id, 120);
    await bet(casey.id, market.id, yes.id, 30);
    await bet(loser.id, market.id, no.id, 240);

    // L = 240, rake = 12, W = 150 → alex floor(120*12/150)=9, casey floor(30*12/150)=2, dust 1
    await resolveMarket(market.id, admin.id, yes.id, "test");

    const entries = await prisma.gemLedgerEntry.findMany({
      where: { marketId: market.id, type: GemLedgerEntryType.RAKE_CONVERSION },
      orderBy: { amount: "desc" },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      userId: alex.id,
      type: GemLedgerEntryType.RAKE_CONVERSION,
      amount: 9,
    });
    expect(entries[1]).toMatchObject({
      userId: casey.id,
      type: GemLedgerEntryType.RAKE_CONVERSION,
      amount: 2,
    });
    expect(await rakeGems(loser.id)).toBe(0);

    // audit column: minted = rake − gem dust, and never exceeds the rake
    const resolution = await prisma.marketResolution.findUniqueOrThrow({ where: { marketId: market.id } });
    expect(resolution.rakeAmount).toBe(12);
    expect(resolution.gemsMinted).toBe(11);

    // re-resolving is blocked by the status guard — no duplicate mint possible
    await expect(resolveMarket(market.id, admin.id, yes.id, "test")).rejects.toThrow(/open or closed/i);
    expect(await rakeGems(alex.id)).toBe(9);
  });

  it("mints nothing on cancels and all-refund settlements", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const blair = await createUser(500);

    // cancel path
    const canceled = await createOpenMarket(admin.id);
    await bet(alex.id, canceled.id, canceled.outcomes[0].id, 100);
    await bet(blair.id, canceled.id, canceled.outcomes[1].id, 100);
    await cancelMarket(canceled.id, admin.id, "test cancel");

    // REFUND_ALL path: nobody backed the winner
    const refunded = await createOpenMarket(admin.id, {
      outcomes: [
        { label: "Arsenal", color: "red" },
        { label: "Draw", color: "amber" },
        { label: "Chelsea", color: "blue" },
      ],
    });
    await bet(alex.id, refunded.id, refunded.outcomes[0].id, 100);
    await bet(blair.id, refunded.id, refunded.outcomes[2].id, 100);
    await resolveMarket(refunded.id, admin.id, refunded.outcomes[1].id, "test");

    expect(await prisma.gemLedgerEntry.count()).toBe(0);
    const resolution = await prisma.marketResolution.findUniqueOrThrow({ where: { marketId: refunded.id } });
    expect(resolution.gemsMinted).toBe(0);
  });

  it("never mints gems from custom-league rake (decision #1: Global only)", async () => {
    const owner = await createUser(500);
    const member = await createUser(500);

    const league = await createLeague({
      ownerId: owner.id,
      name: `Gem Trip ${Date.now() % 1_000_000}`,
      settings: {
        startingStack: 200,
        weeklyAllowance: 0,
        defaultRakeBps: 500,
        defaultMaxStakePerUser: 200,
      },
    });
    await joinLeagueByCode(member.id, league.inviteCode!);
    await createSeason(league.id, owner.id, {
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });

    const market = await createMarket({
      actorId: owner.id,
      leagueId: league.id,
      fields: {
        title: "Custom league rake stays points-only?",
        description: "Resolves YES — custom rake must never mint gems.",
        category: "General",
        closeTime: new Date(Date.now() + 60 * 60 * 1000),
        resolveTime: new Date(Date.now() + 90 * 60 * 1000),
        resolutionSource: "group consensus",
      },
      outcomes: [
        { label: "Yes", color: "green" },
        { label: "No", color: "red" },
      ],
      openNow: true,
    });

    await bet(owner.id, market.id, market.outcomes[0].id, 100);
    await bet(member.id, market.id, market.outcomes[1].id, 100);
    await resolveMarket(market.id, owner.id, market.outcomes[0].id, "group consensus");

    // the points rake burned (audit row shows it) but zero gems minted —
    // and no achievements either (the post-resolve pass skips custom leagues)
    const resolution = await prisma.marketResolution.findUniqueOrThrow({ where: { marketId: market.id } });
    expect(resolution.rakeAmount).toBe(5);
    expect(resolution.gemsMinted).toBe(0);
    expect(await prisma.gemLedgerEntry.count()).toBe(0);
  });

  it("grants first-win and streak achievements exactly once via the resolve hook", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const winner = await createUser(500);
    const loser = await createUser(500);

    for (let round = 0; round < 3; round += 1) {
      const market = await createOpenMarket(admin.id);
      await bet(winner.id, market.id, market.outcomes[0].id, 50);
      await bet(loser.id, market.id, market.outcomes[1].id, 50);
      await resolveMarket(market.id, admin.id, market.outcomes[0].id, "test");
    }

    // resolveMarket's post-commit pass granted these — no manual call needed
    const keys = (
      await prisma.gemLedgerEntry.findMany({
        where: { userId: winner.id, type: GemLedgerEntryType.ACHIEVEMENT },
        select: { achievementKey: true },
      })
    ).map((entry) => entry.achievementKey);
    expect(keys).toContain("first-win");
    expect(keys).toContain("streak-3");
    expect(keys).toHaveLength(2);

    // the loser advanced volume only (below every threshold) — no grants
    expect(
      await prisma.gemLedgerEntry.count({
        where: { userId: loser.id, type: GemLedgerEntryType.ACHIEVEMENT },
      }),
    ).toBe(0);

    // re-running the full evaluation grants nothing new
    expect(await evaluateUserAchievements(winner.id)).toEqual([]);
    expect(
      await prisma.gemLedgerEntry.count({
        where: { userId: winner.id, type: GemLedgerEntryType.ACHIEVEMENT },
      }),
    ).toBe(2);
  });

  it("grants the longshot achievement with its badge, keyed for idempotency", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const favorite = await createUser(500);
    const longshot = await createUser(500);

    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    // favorite stakes 200 on YES first, so NO's pre-bet implied prob is 0/200
    await bet(favorite.id, market.id, yes.id, 200);
    await bet(longshot.id, market.id, no.id, 10);
    await resolveMarket(market.id, admin.id, no.id, "test");

    const entry = await prisma.gemLedgerEntry.findUnique({
      where: {
        userId_achievementKey: { userId: longshot.id, achievementKey: "longshot-win" },
      },
    });
    expect(entry).not.toBeNull();
    expect(entry!.amount).toBe(50);

    const badge = await prisma.userItem.findUnique({
      where: { grantKey: `achievement:longshot-win:user:${longshot.id}` },
      include: { item: true },
    });
    expect(badge).not.toBeNull();
    expect(badge!.item.slug).toBe("badge-longshot");
    expect(badge!.item.storeCost).toBeNull();

    // double evaluation cannot duplicate the badge or the gems
    await evaluateUserAchievements(longshot.id);
    expect(
      await prisma.userItem.count({ where: { userId: longshot.id, itemId: badge!.itemId } }),
    ).toBe(1);

    // the favorite lost — no longshot, no first-win
    expect(
      await prisma.gemLedgerEntry.count({
        where: { userId: favorite.id, type: GemLedgerEntryType.ACHIEVEMENT },
      }),
    ).toBe(0);
  });

  it("excludes canceled markets from achievement history", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const user = await createUser(500);
    const other = await createUser(500);

    const resolved = await createOpenMarket(admin.id);
    await bet(user.id, resolved.id, resolved.outcomes[0].id, 50);
    await bet(other.id, resolved.id, resolved.outcomes[1].id, 50);
    await resolveMarket(resolved.id, admin.id, resolved.outcomes[0].id, "test");

    const canceled = await createOpenMarket(admin.id);
    await bet(user.id, canceled.id, canceled.outcomes[0].id, 50);
    await cancelMarket(canceled.id, admin.id, "test cancel");

    const history = await getUserResolvedHistory(user.id);
    expect(history).toHaveLength(1);
    expect(history[0].marketId).toBe(resolved.id);
    expect(history[0].won).toBe(true);
  });

  it("grants placement gems at Global finalization, exactly once; custom seasons grant none", async () => {
    const league = await ensureGlobalLeague();
    const window = getMonthWindow(new Date(getMonthWindow(new Date()).startsAt.getTime() - 1000));
    const season = await prisma.season.create({
      data: {
        leagueId: league.id,
        index: 1,
        name: "Gem Season",
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        status: SeasonStatus.ACTIVE,
      },
    });

    const admin = await createUser(0, UserRole.ADMIN);
    const alice = await createUser(500);
    const casey = await createUser(500);
    const bob = await createUser(500);

    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;
    await bet(alice.id, market.id, yes.id, 100);
    await bet(casey.id, market.id, yes.id, 50);
    await bet(bob.id, market.id, no.id, 200);
    await resolveMarket(market.id, admin.id, yes.id, "test");
    // land the resolution inside the ended season's window (decision #6)
    await prisma.market.update({
      where: { id: market.id },
      data: { resolvedAt: new Date(season.startsAt.getTime() + 1000) },
    });

    // a custom-league season ending at the same time, with a settled market
    const owner = await createUser(500);
    const member = await createUser(500);
    const custom = await createLeague({
      ownerId: owner.id,
      name: `Gem Custom ${Date.now() % 1_000_000}`,
      settings: { startingStack: 200, weeklyAllowance: 0, defaultRakeBps: 500, defaultMaxStakePerUser: 200 },
    });
    await joinLeagueByCode(member.id, custom.inviteCode!);
    const customSeason = await createSeason(custom.id, owner.id, {
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const customMarket = await createMarket({
      actorId: owner.id,
      leagueId: custom.id,
      fields: {
        title: "Custom placement gems?",
        description: "Resolves NO — custom placements never mint gems.",
        category: "General",
        closeTime: new Date(Date.now() + 30 * 60 * 1000),
        resolveTime: new Date(Date.now() + 45 * 60 * 1000),
        resolutionSource: "group consensus",
      },
      outcomes: [
        { label: "Yes", color: "green" },
        { label: "No", color: "red" },
      ],
      openNow: true,
    });
    await bet(owner.id, customMarket.id, customMarket.outcomes[0].id, 50);
    await bet(member.id, customMarket.id, customMarket.outcomes[1].id, 50);
    await resolveMarket(customMarket.id, owner.id, customMarket.outcomes[1].id, "group consensus");
    await prisma.season.update({
      where: { id: customSeason.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });

    await finalizeDueSeasons(new Date());

    // Global podium: alice #1 (+100), casey #2 (+50), bob #3 (+25)
    const placements = await prisma.gemLedgerEntry.findMany({
      where: { type: GemLedgerEntryType.SEASON_PLACEMENT },
      orderBy: { amount: "desc" },
    });
    expect(placements.map((entry) => [entry.userId, entry.amount, entry.seasonId])).toEqual([
      [alice.id, 100, season.id],
      [casey.id, 50, season.id],
      [bob.id, 25, season.id],
    ]);

    // the custom season finalized with trophies but zero gems
    const customFinal = await prisma.season.findUniqueOrThrow({ where: { id: customSeason.id } });
    expect(customFinal.status).toBe(SeasonStatus.FINALIZED);
    expect(placements.every((entry) => entry.seasonId === season.id)).toBe(true);

    // a second run grants nothing new
    await finalizeDueSeasons(new Date());
    expect(await prisma.gemLedgerEntry.count({ where: { type: GemLedgerEntryType.SEASON_PLACEMENT } })).toBe(3);
  });

  it("purchases atomically: debit + grant, ownership and balance guarded", async () => {
    const user = await createUser(0);
    const frame = await prisma.item.create({
      data: {
        slug: `gem-frame-${Date.now() % 1_000_000}`,
        name: "Test Frame",
        description: "integration test frame",
        kind: ItemKind.FRAME,
        style: { renderer: "css", ring: "#ffaa00" },
        storeCost: 100,
      },
    });

    // broke: rejected, nothing written
    await expect(purchaseItem(user.id, frame.slug)).rejects.toThrow(/not enough gems/i);
    expect(await prisma.userItem.count({ where: { userId: user.id } })).toBe(0);

    await adjustGems(user.id, 150, "test grant");

    const grant = await purchaseItem(user.id, frame.slug);
    expect(grant.source).toBe(ItemSource.PURCHASE);
    expect(await getGemBalance(user.id)).toBe(50);

    // owning it blocks a second purchase
    await expect(purchaseItem(user.id, frame.slug)).rejects.toThrow(/already own/i);
    expect(await getGemBalance(user.id)).toBe(50);

    // unpurchasable and inactive items are rejected
    const earned = await prisma.item.create({
      data: {
        slug: `gem-earned-${Date.now() % 1_000_000}`,
        name: "Earned Only",
        description: "not for sale",
        kind: ItemKind.BADGE,
        style: { renderer: "emoji", glyph: "🎖️" },
        storeCost: null,
      },
    });
    await expect(purchaseItem(user.id, earned.slug)).rejects.toThrow(/earned/i);
    await prisma.item.update({ where: { id: frame.id }, data: { active: false } });
    await expect(purchaseItem(user.id, frame.slug)).rejects.toThrow(/isn't available/i);
  });

  it("collapses a concurrent double-buy to one grant and one debit", async () => {
    const user = await createUser(0);
    await adjustGems(user.id, 500, "test grant");
    const title = await prisma.item.create({
      data: {
        slug: `gem-title-${Date.now() % 1_000_000}`,
        name: "Test Title",
        description: "integration test title",
        kind: ItemKind.TITLE,
        style: { renderer: "css", text: "The Tested" },
        storeCost: 200,
      },
    });

    const results = await Promise.allSettled([
      purchaseItem(user.id, title.slug),
      purchaseItem(user.id, title.slug),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(await prisma.userItem.count({ where: { userId: user.id, itemId: title.id } })).toBe(1);
    expect(await getGemBalance(user.id)).toBe(300);
  });

  it("enforces one equipped item per slot and kind→slot rules", async () => {
    const user = await createUser(0);
    const other = await createUser(0);

    const makeItem = (slug: string, kind: ItemKind, style: object) =>
      prisma.item.create({
        data: { slug: `${slug}-${Date.now() % 1_000_000}`, name: slug, description: slug, kind, style },
      });

    const frameA = await makeItem("eq-frame-a", ItemKind.FRAME, { renderer: "css", ring: "#ffaa00" });
    const frameB = await makeItem("eq-frame-b", ItemKind.FRAME, { renderer: "css", ring: "#00aaff" });
    const badge = await makeItem("eq-badge", ItemKind.BADGE, { renderer: "emoji", glyph: "🎲" });
    const trophy = await makeItem("eq-trophy", ItemKind.TROPHY, { renderer: "emoji", emoji: "🏆" });
    const junkFrame = await makeItem("eq-junk", ItemKind.FRAME, { totally: "wrong" });

    const grants = await Promise.all([
      grantItem({ userId: user.id, itemId: frameA.id, source: ItemSource.ADMIN_GRANT }),
      grantItem({ userId: user.id, itemId: frameB.id, source: ItemSource.ADMIN_GRANT }),
      grantItem({ userId: user.id, itemId: badge.id, source: ItemSource.ADMIN_GRANT }),
      grantItem({ userId: user.id, itemId: trophy.id, source: ItemSource.ADMIN_GRANT }),
      grantItem({ userId: user.id, itemId: junkFrame.id, source: ItemSource.ADMIN_GRANT }),
    ]);
    const [ownedFrameA, ownedFrameB, ownedBadge, ownedTrophy, ownedJunk] = grants;

    // equip a frame + a badge: different slots coexist
    await equipItem(user.id, ownedFrameA.id);
    await equipItem(user.id, ownedBadge.id);

    let cosmetics = (await getEquippedCosmetics([user.id])).get(user.id)!;
    expect(cosmetics.frame).toMatchObject({ ring: "#ffaa00" });
    expect(cosmetics.badge).toMatchObject({ glyph: "🎲" });
    expect(cosmetics.title).toBeNull();

    // equipping the second frame displaces the first — never two per slot
    await equipItem(user.id, ownedFrameB.id);
    cosmetics = (await getEquippedCosmetics([user.id])).get(user.id)!;
    expect(cosmetics.frame).toMatchObject({ ring: "#00aaff" });
    expect(
      await prisma.userItem.count({ where: { userId: user.id, equippedSlot: EquipSlot.FRAME } }),
    ).toBe(1);

    // trophies can't equip; someone else's item can't equip; junk style
    // equips but renders as nothing (parse-safe degradation)
    await expect(equipItem(user.id, ownedTrophy.id)).rejects.toThrow(/display-only/i);
    await expect(equipItem(other.id, ownedFrameA.id)).rejects.toThrow(/isn't in your locker/i);
    await equipItem(user.id, ownedJunk.id);
    cosmetics = (await getEquippedCosmetics([user.id])).get(user.id)!;
    expect(cosmetics.frame).toBeNull();

    // unequip clears the slot; retired items stop rendering without unequip
    await equipItem(user.id, ownedFrameB.id);
    await unequipSlot(user.id, EquipSlot.BADGE);
    cosmetics = (await getEquippedCosmetics([user.id])).get(user.id)!;
    expect(cosmetics.badge).toBeNull();
    await prisma.item.update({ where: { id: frameB.id }, data: { active: false } });
    expect((await getEquippedCosmetics([user.id])).get(user.id)?.frame ?? null).toBeNull();
  });

  it("batches equipped cosmetics for many users in one call and equips purchases immediately", async () => {
    const buyer = await createUser(0);
    const plain = await createUser(0);
    await adjustGems(buyer.id, 500, "test grant");

    const badge = await prisma.item.create({
      data: {
        slug: `eq-buy-badge-${Date.now() % 1_000_000}`,
        name: "Bought Badge",
        description: "purchase-then-equip",
        kind: ItemKind.BADGE,
        style: { renderer: "emoji", glyph: "🦈" },
        storeCost: 100,
      },
    });

    const purchased = await purchaseItem(buyer.id, badge.slug);
    await equipItem(buyer.id, purchased.id);

    const map = await getEquippedCosmetics([buyer.id, plain.id, "nonexistent-user"]);
    expect(map.get(buyer.id)?.badge).toMatchObject({ glyph: "🦈" });
    expect(map.has(plain.id)).toBe(false);
    expect(map.has("nonexistent-user")).toBe(false);
  });

  it("showcases only earned achievements, capped, with a recent-earned fallback", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const winner = await createUser(500);
    const loser = await createUser(500);

    const market = await createOpenMarket(admin.id);
    await bet(winner.id, market.id, market.outcomes[0].id, 50);
    await bet(loser.id, market.id, market.outcomes[1].id, 50);
    await resolveMarket(market.id, admin.id, market.outcomes[0].id, "test");

    // progress lists every definition; exactly one earned so far
    const progress = await getAchievementProgress(winner.id);
    expect(progress.length).toBeGreaterThanOrEqual(8);
    expect(progress.filter((row) => row.earned).map((row) => row.def.key)).toEqual(["first-win"]);

    // no picks yet → fallback to most recently earned
    const fallback = await getShowcasedAchievements(winner.id);
    expect(fallback.map((row) => row.def.key)).toEqual(["first-win"]);
    expect(fallback[0].showcased).toBe(false);

    // explicit pick sticks and marks itself showcased
    await setShowcasedAchievements(winner.id, ["first-win"]);
    const picked = await getShowcasedAchievements(winner.id);
    expect(picked[0].showcased).toBe(true);

    // unearned, unknown, and over-cap picks are rejected
    await expect(setShowcasedAchievements(winner.id, ["streak-10"])).rejects.toThrow(/earned/i);
    await expect(setShowcasedAchievements(winner.id, ["not-a-thing"])).rejects.toThrow(/unknown/i);
    await expect(
      setShowcasedAchievements(winner.id, ["first-win", "streak-3", "streak-5", "streak-10"]),
    ).rejects.toThrow(/up to 3/i);

    // clearing works
    await setShowcasedAchievements(winner.id, []);
    expect((await getShowcasedAchievements(winner.id))[0].showcased).toBe(false);
  });

  it("grants the 1000-gem starting allowance at approval and via backfill, once ever", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const existing = await createUser(0); // ACTIVE, predates the allowance

    // a new signup approved after launch gets it at approval
    counter += 1;
    const applicant = await prisma.user.create({
      data: {
        email: `gem-applicant-${Date.now()}-${counter}@test.local`,
        name: `GemApplicant${counter}`,
        username: `gem-applicant-${Date.now() % 1_000_000}-${counter}`,
        passwordHash: "not-a-real-hash",
        status: UserStatus.PENDING,
      },
    });
    await approveUser(applicant.id, admin.id);
    expect(await getGemBalance(applicant.id)).toBe(1000);

    // existing members get theirs from the backfill — approved users don't double
    const first = await backfillStartingGrants();
    expect(first.granted).toBeGreaterThanOrEqual(2); // admin + existing, not applicant
    expect(await getGemBalance(existing.id)).toBe(1000);
    expect(await getGemBalance(applicant.id)).toBe(1000);
    expect(
      await prisma.gemLedgerEntry.count({
        where: { userId: applicant.id, type: GemLedgerEntryType.STARTING_GRANT },
      }),
    ).toBe(1);

    // wholly idempotent on re-run
    expect((await backfillStartingGrants()).granted).toBe(0);
  });

  it("backfills historical markets and seasons idempotently, never doubling live grants", async () => {
    const globalId = await globalLeagueId();
    const admin = await createUser(0, UserRole.ADMIN);
    const alex = await createUser(500);
    const casey = await createUser(500);
    const bob = await createUser(500);

    // a market settled through the LIVE path — gems already minted
    const live = await createOpenMarket(admin.id);
    await bet(alex.id, live.id, live.outcomes[0].id, 100);
    await bet(bob.id, live.id, live.outcomes[1].id, 200);
    await resolveMarket(live.id, admin.id, live.outcomes[0].id, "test");

    // a "historical" market: RESOLVED with stakes + resolution but NO gem
    // rows — what prod looks like the moment Phase 3a deploys
    const historical = await prisma.market.create({
      data: {
        title: "Historical market",
        leagueId: globalId,
        description: "settled before gems existed",
        category: "Test",
        closeTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        resolveTime: new Date(Date.now() - 60 * 60 * 1000),
        resolutionSource: "test",
        status: MarketStatus.RESOLVED,
        maxStakePerUser: 500,
        rakeBps: 500,
        createdById: admin.id,
        resolvedById: admin.id,
        resolvedAt: new Date(Date.now() - 60 * 60 * 1000),
        outcomes: {
          create: [
            { label: "Yes", color: "green", sortOrder: 0, pool: 150, poolFinal: 150 },
            { label: "No", color: "red", sortOrder: 1, pool: 240, poolFinal: 240 },
          ],
        },
      },
      include: { outcomes: { orderBy: { sortOrder: "asc" } } },
    });
    const [histYes, histNo] = historical.outcomes;
    await prisma.market.update({
      where: { id: historical.id },
      data: { winningOutcomeId: histYes.id },
    });
    await prisma.poolStake.createMany({
      data: [
        { userId: alex.id, marketId: historical.id, outcomeId: histYes.id, amount: 120 },
        { userId: casey.id, marketId: historical.id, outcomeId: histYes.id, amount: 30 },
        { userId: bob.id, marketId: historical.id, outcomeId: histNo.id, amount: 240 },
      ],
    });
    // rake = floor(240 * 5%) = 12, W = 150 → alex 9, casey 2, dust 1
    await prisma.marketResolution.create({
      data: {
        marketId: historical.id,
        winningOutcomeId: histYes.id,
        resolutionSource: "test",
        winningPool: 150,
        losingPool: 240,
        rakeAmount: 12,
        dustAmount: 1,
        totalPaidOut: 377,
        createdById: admin.id,
      },
    });

    // a finalized season with frozen standings but no placement gems
    const window = getMonthWindow(new Date(getMonthWindow(new Date()).startsAt.getTime() - 1000));
    const season = await prisma.season.create({
      data: {
        leagueId: globalId,
        index: 99,
        name: "Historical Season",
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        status: SeasonStatus.FINALIZED,
        finalizedAt: new Date(),
        standings: [
          { userId: alex.id, name: "A", username: "a", score: 100, marketsSettled: 1, marketsWon: 1, rank: 1 },
          { userId: bob.id, name: "B", username: "b", score: -100, marketsSettled: 1, marketsWon: 0, rank: 2 },
        ],
      },
    });

    const rakeRun = await backfillRakeConversions(globalId);
    expect(rakeRun.converted).toBe(1); // just the historical market
    expect(rakeRun.skipped).toBe(0);
    const histEntries = await prisma.gemLedgerEntry.findMany({
      where: { marketId: historical.id, type: GemLedgerEntryType.RAKE_CONVERSION },
      orderBy: { amount: "desc" },
    });
    expect(histEntries.map((entry) => [entry.userId, entry.amount])).toEqual([
      [alex.id, 9],
      [casey.id, 2],
    ]);
    expect(
      (await prisma.marketResolution.findUniqueOrThrow({ where: { marketId: historical.id } })).gemsMinted,
    ).toBe(11);

    const placementRun = await backfillPlacements(globalId);
    expect(placementRun.granted).toBe(2);
    expect(
      await prisma.gemLedgerEntry.count({
        where: { seasonId: season.id, type: GemLedgerEntryType.SEASON_PLACEMENT },
      }),
    ).toBe(2);

    const achievementRun = await backfillAchievements(globalId);
    expect(achievementRun.participants).toBe(3);

    // the whole thing re-runs to zero new grants
    const totalBefore = await prisma.gemLedgerEntry.count();
    const rakeAgain = await backfillRakeConversions(globalId);
    expect(rakeAgain.converted).toBe(0);
    expect((await backfillPlacements(globalId)).granted).toBe(0);
    expect((await backfillAchievements(globalId)).grants).toBe(0);
    expect(await prisma.gemLedgerEntry.count()).toBe(totalBefore);
  });
});
