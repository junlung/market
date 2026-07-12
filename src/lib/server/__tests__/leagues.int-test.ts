/**
 * Integration tests for phase 2a (leagues + seasons) against a real Postgres:
 * global-league bootstrap races, one-season-per-month races, decision #6
 * attribution (P&L lands in the month the market RESOLVES), and the
 * finalization loop — frozen standings, idempotent trophy grants, season roll.
 *
 * Run via `npm run test:integration` (requires TEST_DATABASE_URL).
 */
import {
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
import { ensureLeagueAllowance, ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { placeBet } from "@/lib/server/bet-service";
import {
  createLeague,
  ensureGlobalLeague,
  ensureLeagueMembership,
  getLeagueBalance,
  joinLeagueByCode,
  rotateInviteCode,
  updateLeagueSettings,
} from "@/lib/server/league-service";
import {
  cancelMarket,
  createMarket,
  getUserBalance,
  requireMarketOperator,
  resolveMarket,
} from "@/lib/server/market-service";
import { approveUser } from "@/lib/server/member-service";
import {
  createSeason,
  ensureCurrentSeason,
  finalizeDueSeasons,
  getSeasonStandings,
  type SeasonStandingRow,
} from "@/lib/server/season-service";

const enabled = process.env.INTEGRATION_TESTS === "1";

let counter = 0;

async function globalLeagueId() {
  return (await ensureGlobalLeague()).id;
}

async function createUser(balance: number, role: UserRole = UserRole.MEMBER) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `lg-user-${Date.now()}-${counter}@test.local`,
      name: `LgUser${counter}`,
      username: `lg-user-${Date.now() % 1_000_000}-${counter}`,
      passwordHash: "not-a-real-hash",
      role,
      status: UserStatus.ACTIVE,
    },
  });

  // betting is members-only, even in the Global League
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
      title: `League market ${counter}`,
      leagueId: await globalLeagueId(),
      description: "league integration test market",
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

function bet(userId: string, marketId: string, outcomeId: string, amount: number) {
  return placeBet({ userId, marketId, outcomeId, amount, skipRateLimit: true });
}

/** The previous UTC month's window — for staging seasons that already ended. */
function lastMonthWindow() {
  const currentStart = getMonthWindow(new Date()).startsAt;
  return getMonthWindow(new Date(currentStart.getTime() - 1000));
}

async function createEndedSeason(leagueId: string) {
  const { startsAt, endsAt } = lastMonthWindow();
  return prisma.season.create({
    data: {
      leagueId,
      index: 1,
      name: "Test Season",
      startsAt,
      endsAt,
      status: SeasonStatus.ACTIVE,
    },
  });
}

describe.skipIf(!enabled)("leagues + seasons integration", () => {
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
    await prisma.season.deleteMany();
    await prisma.leagueMembership.deleteMany();
    await prisma.league.deleteMany({ where: { isGlobal: false } });
    await prisma.user.deleteMany();
  });

  it("bootstraps exactly one global league under concurrency", async () => {
    await prisma.league.deleteMany();

    const leagues = await Promise.all(Array.from({ length: 6 }, () => ensureGlobalLeague()));

    expect(new Set(leagues.map((league) => league.id)).size).toBe(1);
    expect(await prisma.league.count()).toBe(1);
    expect(leagues[0].isGlobal).toBe(true);
    expect(leagues[0].slug).toBe("global");
  });

  it("enrolls a member in the global league at approval, idempotently", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const applicant = await prisma.user.create({
      data: {
        email: `lg-applicant-${Date.now()}@test.local`,
        name: "Applicant",
        username: `lg-applicant-${Date.now() % 1_000_000}`,
        passwordHash: "not-a-real-hash",
        status: UserStatus.PENDING,
      },
    });

    await approveUser(applicant.id, admin.id);

    const league = await ensureGlobalLeague();
    const memberships = await prisma.leagueMembership.findMany({
      where: { userId: applicant.id },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].leagueId).toBe(league.id);
  });

  it("opens exactly one season per month under concurrency", async () => {
    const league = await ensureGlobalLeague();

    const seasons = await Promise.all(
      Array.from({ length: 6 }, () => ensureCurrentSeason(league.id)),
    );

    expect(new Set(seasons.map((season) => season.id)).size).toBe(1);
    expect(await prisma.season.count()).toBe(1);

    const { startsAt, endsAt } = getMonthWindow(new Date());
    expect(seasons[0].startsAt.getTime()).toBe(startsAt.getTime());
    expect(seasons[0].endsAt.getTime()).toBe(endsAt.getTime());
    expect(seasons[0].index).toBe(1);
    expect(seasons[0].status).toBe(SeasonStatus.ACTIVE);
  });

  it("attributes realized P&L to the month the market resolves (decision #6)", async () => {
    const league = await ensureGlobalLeague();
    const season = await ensureCurrentSeason(league.id);
    const admin = await createUser(0, UserRole.ADMIN);
    const alice = await createUser(500);
    const bob = await createUser(500);
    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    await bet(alice.id, market.id, yes.id, 100);
    await bet(bob.id, market.id, no.id, 100);

    // the bets went in "last month" — only the resolution month may count them
    const lastMonth = new Date(lastMonthWindow().startsAt.getTime() + 1000);
    await prisma.ledgerEntry.updateMany({
      where: { marketId: market.id },
      data: { createdAt: lastMonth },
    });
    await prisma.bet.updateMany({ where: { marketId: market.id }, data: { createdAt: lastMonth } });

    await resolveMarket(market.id, admin.id, yes.id, "test");

    const standings = await getSeasonStandings(season);
    expect(standings).toHaveLength(2);

    // losing pool 100, rake 5% = 5 → alice payout 195, season score +95
    const [first, second] = standings;
    expect(first.userId).toBe(alice.id);
    expect(first.score).toBe(95);
    expect(first.rank).toBe(1);
    expect(first.marketsWon).toBe(1);
    expect(first.marketsSettled).toBe(1);
    expect(second.userId).toBe(bob.id);
    expect(second.score).toBe(-100);
    expect(second.marketsWon).toBe(0);
  });

  it("ignores open positions, canceled markets, and resolutions outside the window", async () => {
    const league = await ensureGlobalLeague();
    const season = await ensureCurrentSeason(league.id);
    const admin = await createUser(0, UserRole.ADMIN);
    const alice = await createUser(500);
    const bob = await createUser(500);

    // open market: stakes at risk, nothing settled
    const open = await createOpenMarket(admin.id);
    await bet(alice.id, open.id, open.outcomes[0].id, 50);

    // canceled market: refunds net to zero and the market isn't RESOLVED
    const canceled = await createOpenMarket(admin.id);
    await bet(alice.id, canceled.id, canceled.outcomes[0].id, 40);
    await cancelMarket(canceled.id, admin.id, "test cancel");

    // resolved market, but last month — belongs to the previous season
    const previous = await createOpenMarket(admin.id);
    await bet(alice.id, previous.id, previous.outcomes[0].id, 30);
    await bet(bob.id, previous.id, previous.outcomes[1].id, 30);
    await resolveMarket(previous.id, admin.id, previous.outcomes[0].id, "test");
    await prisma.market.update({
      where: { id: previous.id },
      data: { resolvedAt: new Date(lastMonthWindow().startsAt.getTime() + 1000) },
    });

    expect(await getSeasonStandings(season)).toHaveLength(0);
  });

  it("finalizes an ended season: freezes standings, grants trophies once, opens the next", async () => {
    const league = await ensureGlobalLeague();
    const season = await createEndedSeason(league.id);
    const admin = await createUser(0, UserRole.ADMIN);
    const alice = await createUser(500);
    const bob = await createUser(500);
    const casey = await createUser(500);
    const market = await createOpenMarket(admin.id);
    const [yes, no] = market.outcomes;

    await bet(alice.id, market.id, yes.id, 100);
    await bet(casey.id, market.id, yes.id, 50);
    await bet(bob.id, market.id, no.id, 200);
    await resolveMarket(market.id, admin.id, yes.id, "test");

    // land the resolution inside the ended season's window
    await prisma.market.update({
      where: { id: market.id },
      data: { resolvedAt: new Date(season.startsAt.getTime() + 1000) },
    });

    const summaries = await finalizeDueSeasons(new Date());
    expect(summaries).toHaveLength(1);
    expect(summaries[0].seasonId).toBe(season.id);
    expect(summaries[0].participants).toBe(3);
    expect(summaries[0].trophiesGranted).toBe(3);

    // the season is frozen with full standings
    const finalized = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(finalized.status).toBe(SeasonStatus.FINALIZED);
    expect(finalized.finalizedAt).not.toBeNull();
    const standings = finalized.standings as unknown as SeasonStandingRow[];
    // W=150, L=200, rake 5% → distributable 190: alice +126, casey +63, bob −200
    expect(standings.map((row) => [row.userId, row.score, row.rank])).toEqual([
      [alice.id, 126, 1],
      [casey.id, 63, 2],
      [bob.id, -200, 3],
    ]);

    // trophies with provenance, one per placement
    const grants = await prisma.userItem.findMany({ include: { item: true } });
    expect(grants).toHaveLength(3);
    const bySlug = new Map(grants.map((grant) => [grant.item.slug, grant]));
    expect(bySlug.get("season-champion")?.userId).toBe(alice.id);
    expect(bySlug.get("season-runner-up")?.userId).toBe(casey.id);
    expect(bySlug.get("season-third")?.userId).toBe(bob.id);
    expect(grants.every((grant) => grant.source === ItemSource.SEASON_TROPHY)).toBe(true);
    const champProvenance = bySlug.get("season-champion")?.provenance as Record<string, unknown>;
    expect(champProvenance.placement).toBe(1);
    expect(champProvenance.seasonId).toBe(season.id);

    // the next (current) season is open
    const current = await prisma.season.findFirstOrThrow({
      where: { leagueId: league.id, status: SeasonStatus.ACTIVE },
    });
    expect(current.startsAt.getTime()).toBe(getMonthWindow(new Date()).startsAt.getTime());
    expect(current.index).toBe(season.index + 1);

    // a second run is a no-op: no re-finalization, no duplicate trophies
    expect(await finalizeDueSeasons(new Date())).toHaveLength(0);
    expect(await prisma.userItem.count()).toBe(3);
  });

  it("finalizes a season with no settled markets without granting trophies", async () => {
    const league = await ensureGlobalLeague();
    const season = await createEndedSeason(league.id);

    const summaries = await finalizeDueSeasons(new Date());
    expect(summaries).toHaveLength(1);
    expect(summaries[0].participants).toBe(0);
    expect(summaries[0].trophiesGranted).toBe(0);

    const finalized = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(finalized.status).toBe(SeasonStatus.FINALIZED);
    expect(finalized.standings).toEqual([]);
    expect(await prisma.userItem.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2b: custom leagues
// ---------------------------------------------------------------------------

describe.skipIf(!enabled)("custom leagues (2b)", () => {
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
    await prisma.season.deleteMany();
    await prisma.leagueMembership.deleteMany();
    await prisma.league.deleteMany({ where: { isGlobal: false } });
    await prisma.user.deleteMany();
  });

  async function createCustomLeague(ownerId: string, settings?: Partial<Parameters<typeof createLeague>[0]["settings"]>) {
    counter += 1;
    return createLeague({
      ownerId,
      name: `Trip League ${Date.now() % 1_000_000}-${counter}`,
      settings: {
        startingStack: 200,
        weeklyAllowance: 0,
        defaultRakeBps: 0,
        defaultMaxStakePerUser: 200,
        ...settings,
      },
    });
  }

  function startSeason(leagueId: string, ownerId: string) {
    return createSeason(leagueId, ownerId, {
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
  }

  it("keeps fresh stacks and the Global League economy fully isolated", async () => {
    const owner = await createUser(500);
    const member = await createUser(500);

    const league = await createCustomLeague(owner.id);
    await joinLeagueByCode(member.id, league.inviteCode!);
    const season = await startSeason(league.id, owner.id);

    const scope = {
      leagueId: league.id,
      balancePolicy: league.balancePolicy,
      seasonId: season.id,
    };

    // both got exactly the starting stack; global balances untouched
    expect(await getLeagueBalance(owner.id, scope)).toBe(200);
    expect(await getLeagueBalance(member.id, scope)).toBe(200);
    expect(await getUserBalance(member.id)).toBe(500);

    const market = await createMarket({
      actorId: owner.id,
      leagueId: league.id,
      fields: {
        title: "Does the boat actually leave the dock?",
        description: "Resolves YES if we are on the water by noon Saturday.",
        category: "Trip",
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

    // markets inherit the league economy, are pinned to the season
    expect(market.leagueId).toBe(league.id);
    expect(market.seasonId).toBe(season.id);
    expect(market.rakeBps).toBe(0);
    expect(market.maxStakePerUser).toBe(200);

    // a 500-point global balance cannot buy a 300-point league bet
    await expect(
      bet(member.id, market.id, market.outcomes[0].id, 201),
    ).rejects.toThrow(/balance|cap/i);

    await bet(member.id, market.id, market.outcomes[0].id, 150);
    expect(await getLeagueBalance(member.id, scope)).toBe(50);
    expect(await getUserBalance(member.id)).toBe(500); // global untouched

    // and league points never leak back: settle and check global again
    await bet(owner.id, market.id, market.outcomes[1].id, 100);
    await resolveMarket(market.id, owner.id, market.outcomes[0].id, "consensus");
    expect(await getLeagueBalance(member.id, scope)).toBe(300); // 50 + 250 payout (no rake)
    expect(await getUserBalance(member.id)).toBe(500);
    expect(await getUserBalance(owner.id)).toBe(500);
  });

  it("blocks non-members from betting on league markets", async () => {
    const owner = await createUser(500);
    const outsider = await createUser(500);
    const league = await createCustomLeague(owner.id);
    await startSeason(league.id, owner.id);

    const market = await createMarket({
      actorId: owner.id,
      leagueId: league.id,
      fields: {
        title: "Private league market?",
        description: "Members only, this is the test for that.",
        category: "Trip",
        closeTime: new Date(Date.now() + 60 * 60 * 1000),
        resolveTime: new Date(Date.now() + 90 * 60 * 1000),
        resolutionSource: "test",
      },
      outcomes: [
        { label: "Yes", color: "green" },
        { label: "No", color: "red" },
      ],
      openNow: true,
    });

    await expect(bet(outsider.id, market.id, market.outcomes[0].id, 10)).rejects.toThrow(
      /league members/i,
    );
  });

  it("rotates the invite code: old dies, new works, members can't rotate", async () => {
    const owner = await createUser(0);
    const friend = await createUser(0);
    const stranger = await createUser(0);
    const league = await createCustomLeague(owner.id);
    const oldCode = league.inviteCode!;

    await joinLeagueByCode(friend.id, oldCode);
    await expect(rotateInviteCode(league.id, friend.id)).rejects.toThrow(/permission/i);

    const rotated = await rotateInviteCode(league.id, owner.id);
    expect(rotated.inviteCode).not.toBe(oldCode);

    await expect(joinLeagueByCode(stranger.id, oldCode)).rejects.toThrow(/doesn't match/i);
    await joinLeagueByCode(stranger.id, rotated.inviteCode!);
    expect(
      await prisma.leagueMembership.count({ where: { leagueId: league.id } }),
    ).toBe(3);
  });

  it("grants a mid-season joiner their stack exactly once", async () => {
    const owner = await createUser(0);
    const late = await createUser(0);
    const league = await createCustomLeague(owner.id);
    const season = await startSeason(league.id, owner.id);

    await joinLeagueByCode(late.id, league.inviteCode!);
    await joinLeagueByCode(late.id, league.inviteCode!); // double-join is a no-op

    const stacks = await prisma.ledgerEntry.findMany({
      where: { userId: late.id, seasonId: season.id, type: LedgerEntryType.SEASON_STACK },
    });
    expect(stacks).toHaveLength(1);
    expect(stacks[0].amount).toBe(200);
  });

  it("gates market operations to owner/mods (and app admins)", async () => {
    const owner = await createUser(500);
    const member = await createUser(500);
    const admin = await createUser(0, UserRole.ADMIN);
    const league = await createCustomLeague(owner.id);
    await joinLeagueByCode(member.id, league.inviteCode!);
    await startSeason(league.id, owner.id);

    const market = await createMarket({
      actorId: owner.id,
      leagueId: league.id,
      fields: {
        title: "Who does the dishes tonight?",
        description: "Loser of the coin flip, obviously. Resolves by group vote.",
        category: "Trip",
        closeTime: new Date(Date.now() + 60 * 60 * 1000),
        resolveTime: new Date(Date.now() + 90 * 60 * 1000),
        resolutionSource: "group vote",
      },
      outcomes: [
        { label: "Alex", color: "blue" },
        { label: "Blair", color: "pink" },
      ],
      openNow: true,
    });

    await expect(requireMarketOperator(market.id, member.id)).rejects.toThrow(/permission/i);
    await expect(requireMarketOperator(market.id, owner.id)).resolves.toBeTruthy();
    await expect(requireMarketOperator(market.id, admin.id)).resolves.toBeTruthy();
  });

  it("credits the league allowance per league-week, scoped to the active season", async () => {
    const owner = await createUser(0);
    const league = await createCustomLeague(owner.id, { weeklyAllowance: 50 });
    const season = await startSeason(league.id, owner.id);
    const fullLeague = await prisma.league.findUniqueOrThrow({ where: { id: league.id } });

    // remove the global placeholder so both paths run for real
    await prisma.ledgerEntry.deleteMany({
      where: { userId: owner.id, type: LedgerEntryType.WEEKLY_ALLOWANCE },
    });

    await ensureWeeklyAllowance(owner.id);
    await Promise.all(
      Array.from({ length: 4 }, () => ensureLeagueAllowance(owner.id, fullLeague)),
    );

    const rows = await prisma.ledgerEntry.findMany({
      where: { userId: owner.id, type: LedgerEntryType.WEEKLY_ALLOWANCE },
      orderBy: { amount: "asc" },
    });
    expect(rows).toHaveLength(2); // one global, one league — same week
    const leagueRow = rows.find((row) => row.leagueId === league.id)!;
    expect(leagueRow.amount).toBe(50);
    expect(leagueRow.seasonId).toBe(season.id);
  });

  it("locks economy settings once the first season starts", async () => {
    const owner = await createUser(0);
    const league = await createCustomLeague(owner.id);

    await updateLeagueSettings(league.id, owner.id, {
      name: league.name,
      settings: {
        startingStack: 300,
        weeklyAllowance: 0,
        defaultRakeBps: 0,
        defaultMaxStakePerUser: 300,
      },
    });

    await startSeason(league.id, owner.id);

    await expect(
      updateLeagueSettings(league.id, owner.id, {
        name: league.name,
        settings: {
          startingStack: 999,
          weeklyAllowance: 0,
          defaultRakeBps: 0,
          defaultMaxStakePerUser: 300,
        },
      }),
    ).rejects.toThrow(/lock/i);

    // name stays editable
    await updateLeagueSettings(league.id, owner.id, {
      name: "Renamed League",
      settings: {
        startingStack: 300,
        weeklyAllowance: 0,
        defaultRakeBps: 0,
        defaultMaxStakePerUser: 300,
      },
    });
    const renamed = await prisma.league.findUniqueOrThrow({ where: { id: league.id } });
    expect(renamed.name).toBe("Renamed League");
    expect(renamed.startingStack).toBe(300);
  });

  it("finalizes a custom season only after its markets settle, attributing by season", async () => {
    const owner = await createUser(0);
    const member = await createUser(0);
    const league = await createCustomLeague(owner.id);
    await joinLeagueByCode(member.id, league.inviteCode!);
    const season = await startSeason(league.id, owner.id);

    const market = await createMarket({
      actorId: owner.id,
      leagueId: league.id,
      fields: {
        title: "Does anyone catch a fish?",
        description: "Resolves YES if any member lands a fish before Sunday 6pm.",
        category: "Trip",
        closeTime: new Date(Date.now() + 60 * 60 * 1000),
        resolveTime: new Date(Date.now() + 90 * 60 * 1000),
        resolutionSource: "photo evidence",
      },
      outcomes: [
        { label: "Yes", color: "green" },
        { label: "No", color: "red" },
      ],
      openNow: true,
    });

    await bet(owner.id, market.id, market.outcomes[0].id, 100);
    await bet(member.id, market.id, market.outcomes[1].id, 100);

    // the weekend ends with the market still open → finalization must wait
    await prisma.season.update({
      where: { id: season.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    expect((await finalizeDueSeasons(new Date())).map((s) => s.seasonId)).not.toContain(season.id);
    expect(
      (await prisma.season.findUniqueOrThrow({ where: { id: season.id } })).status,
    ).toBe(SeasonStatus.ACTIVE);

    // commissioner resolves on Monday — AFTER the window — and it still counts
    await resolveMarket(market.id, owner.id, market.outcomes[0].id, "photo evidence");

    const summaries = await finalizeDueSeasons(new Date());
    const summary = summaries.find((s) => s.seasonId === season.id);
    expect(summary).toBeDefined();
    expect(summary!.participants).toBe(2);
    expect(summary!.trophiesGranted).toBe(2);

    const finalized = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(finalized.status).toBe(SeasonStatus.FINALIZED);
    const standings = finalized.standings as unknown as SeasonStandingRow[];
    expect(standings[0].userId).toBe(owner.id);
    expect(standings[0].score).toBe(100); // no rake in this league
    expect(standings[1].userId).toBe(member.id);
    expect(standings[1].score).toBe(-100);

    // manual roll: finalization must NOT auto-open a next custom season
    expect(
      await prisma.season.count({
        where: { leagueId: league.id, status: { in: [SeasonStatus.ACTIVE, SeasonStatus.UPCOMING] } },
      }),
    ).toBe(0);

    // trophies carry league provenance
    const grants = await prisma.userItem.findMany({ include: { item: true } });
    expect(grants).toHaveLength(2);
    const champ = grants.find((grant) => grant.item.slug === "season-champion")!;
    expect(champ.userId).toBe(owner.id);
    expect((champ.provenance as Record<string, unknown>).leagueSlug).toBe(league.slug);
  });

  it("rejects markets that outlive the season and season creation while one runs", async () => {
    const owner = await createUser(0);
    const league = await createCustomLeague(owner.id);
    const season = await startSeason(league.id, owner.id);

    await expect(
      createMarket({
        actorId: owner.id,
        leagueId: league.id,
        fields: {
          title: "Will this market outlive the season?",
          description: "It should never exist — closes after the season ends.",
          category: "Trip",
          closeTime: new Date(season.endsAt.getTime() + 60 * 60 * 1000),
          resolveTime: new Date(season.endsAt.getTime() + 2 * 60 * 60 * 1000),
          resolutionSource: "test",
        },
        outcomes: [
          { label: "Yes", color: "green" },
          { label: "No", color: "red" },
        ],
        openNow: true,
      }),
    ).rejects.toThrow(/close before/i);

    await expect(startSeason(league.id, owner.id)).rejects.toThrow(/still active/i);
  });
});
