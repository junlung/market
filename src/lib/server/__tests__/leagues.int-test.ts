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
  LeagueInviteStatus,
  LeagueRole,
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
  acceptLeagueInvite,
  createLeague,
  createLeagueInvite,
  declineLeagueInvite,
  deleteLeague,
  ensureGlobalLeague,
  ensureLeagueMembership,
  getLeagueBalance,
  getLeagueByInviteCode,
  joinLeagueByCode,
  listInvitableUsers,
  listPendingInvitesForUser,
  revokeLeagueInvite,
  rotateInviteCode,
  setMemberRole,
  updateLeagueCategories,
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
    await prisma.leagueInvite.deleteMany();
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
    await prisma.leagueInvite.deleteMany();
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
        category: "General",
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
        category: "General",
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
        category: "General",
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
          category: "General",
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

  describe("league invites", () => {
    it("owner invites an active member and the invitee sees it pending", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);

      const invite = await createLeagueInvite(league.id, owner.id, invitee.id);
      expect(invite.status).toBe(LeagueInviteStatus.PENDING);

      const pending = await listPendingInvitesForUser(invitee.id);
      expect(pending).toHaveLength(1);
      expect(pending[0].league.slug).toBe(league.slug);
    });

    it("double-invite races collapse to one pending row (partial unique)", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);

      const results = await Promise.allSettled([
        createLeagueInvite(league.id, owner.id, invitee.id),
        createLeagueInvite(league.id, owner.id, invitee.id),
      ]);

      const rows = await prisma.leagueInvite.findMany({ where: { userId: invitee.id } });
      expect(rows).toHaveLength(1);
      // at least one call succeeded; a losing racer got the friendly error
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      for (const r of results) {
        if (r.status === "rejected") {
          expect(String(r.reason)).toMatch(/pending invite/i);
        }
      }
    });

    it("re-invite after decline creates a fresh pending invite and keeps the declined row", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);

      const first = await createLeagueInvite(league.id, owner.id, invitee.id);
      await declineLeagueInvite(first.id, invitee.id);

      const second = await createLeagueInvite(league.id, owner.id, invitee.id);
      expect(second.id).not.toBe(first.id);

      const rows = await prisma.leagueInvite.findMany({
        where: { userId: invitee.id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((row) => row.status)).toEqual([
        LeagueInviteStatus.DECLINED,
        LeagueInviteStatus.PENDING,
      ]);
    });

    it("accept creates the membership and deals the stack for a season started after the invite", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);

      const invite = await createLeagueInvite(league.id, owner.id, invitee.id);
      const season = await startSeason(league.id, owner.id);

      const joined = await acceptLeagueInvite(invite.id, invitee.id);
      expect(joined.slug).toBe(league.slug);

      const membership = await prisma.leagueMembership.findUnique({
        where: { leagueId_userId: { leagueId: league.id, userId: invitee.id } },
      });
      expect(membership).not.toBeNull();

      const stacks = await prisma.ledgerEntry.findMany({
        where: { userId: invitee.id, seasonId: season.id, type: LedgerEntryType.SEASON_STACK },
      });
      expect(stacks).toHaveLength(1);
      expect(stacks[0].amount).toBe(200);

      const row = await prisma.leagueInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(row.status).toBe(LeagueInviteStatus.ACCEPTED);
      expect(row.respondedAt).not.toBeNull();
    });

    it("double-click accept is idempotent", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);
      await startSeason(league.id, owner.id);
      const invite = await createLeagueInvite(league.id, owner.id, invitee.id);

      const results = await Promise.allSettled([
        acceptLeagueInvite(invite.id, invitee.id),
        acceptLeagueInvite(invite.id, invitee.id),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);

      const memberships = await prisma.leagueMembership.findMany({
        where: { leagueId: league.id, userId: invitee.id },
      });
      expect(memberships).toHaveLength(1);
      const stacks = await prisma.ledgerEntry.findMany({
        where: { userId: invitee.id, leagueId: league.id, type: LedgerEntryType.SEASON_STACK },
      });
      expect(stacks).toHaveLength(1);
    });

    it("accept racing a concurrent code-join never duplicates membership or stack", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);
      await startSeason(league.id, owner.id);
      const invite = await createLeagueInvite(league.id, owner.id, invitee.id);

      const results = await Promise.allSettled([
        acceptLeagueInvite(invite.id, invitee.id),
        joinLeagueByCode(invitee.id, league.inviteCode!),
      ]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);

      const memberships = await prisma.leagueMembership.findMany({
        where: { leagueId: league.id, userId: invitee.id },
      });
      expect(memberships).toHaveLength(1);
      const stacks = await prisma.ledgerEntry.findMany({
        where: { userId: invitee.id, leagueId: league.id, type: LedgerEntryType.SEASON_STACK },
      });
      expect(stacks).toHaveLength(1);
    });

    it("accept after already joining by code still marks the invite accepted", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);
      const invite = await createLeagueInvite(league.id, owner.id, invitee.id);

      await joinLeagueByCode(invitee.id, league.inviteCode!);
      await acceptLeagueInvite(invite.id, invitee.id);

      const row = await prisma.leagueInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(row.status).toBe(LeagueInviteStatus.ACCEPTED);
      const memberships = await prisma.leagueMembership.findMany({
        where: { leagueId: league.id, userId: invitee.id },
      });
      expect(memberships).toHaveLength(1);
    });

    it("MEMBERs cannot invite and demoted inviters cannot revoke", async () => {
      const owner = await createUser(0);
      const mod = await createUser(0);
      const plain = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);
      await joinLeagueByCode(mod.id, league.inviteCode!);
      await joinLeagueByCode(plain.id, league.inviteCode!);
      await setMemberRole(league.id, owner.id, mod.id, LeagueRole.MOD);

      await expect(createLeagueInvite(league.id, plain.id, invitee.id)).rejects.toThrow(
        /permission/i,
      );

      // a mod can invite…
      const invite = await createLeagueInvite(league.id, mod.id, invitee.id);
      // …but loses revoke rights when demoted back to MEMBER
      await setMemberRole(league.id, owner.id, mod.id, LeagueRole.MEMBER);
      await expect(revokeLeagueInvite(invite.id, mod.id)).rejects.toThrow(/permission/i);
    });

    it("cannot invite pending/rejected users, existing members, or into the global league", async () => {
      const owner = await createUser(0);
      const member = await createUser(0);
      const league = await createCustomLeague(owner.id);
      await joinLeagueByCode(member.id, league.inviteCode!);

      const pendingUser = await prisma.user.create({
        data: {
          email: `pending-${Date.now()}@test.local`,
          name: "Pending Pete",
          username: `pending-${Date.now() % 1_000_000}`,
          passwordHash: "not-a-real-hash",
          status: UserStatus.PENDING,
        },
      });

      await expect(createLeagueInvite(league.id, owner.id, pendingUser.id)).rejects.toThrow(
        /approved members/i,
      );
      await expect(createLeagueInvite(league.id, owner.id, member.id)).rejects.toThrow(
        /already a member/i,
      );

      const admin = await createUser(0, UserRole.ADMIN);
      const someone = await createUser(0);
      await expect(
        createLeagueInvite(await globalLeagueId(), admin.id, someone.id),
      ).rejects.toThrow(/Global League/i);
    });

    it("revoke deletes the pending invite; revoking a responded invite is a no-op", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const league = await createCustomLeague(owner.id);

      const invite = await createLeagueInvite(league.id, owner.id, invitee.id);
      await revokeLeagueInvite(invite.id, owner.id);
      expect(await prisma.leagueInvite.findUnique({ where: { id: invite.id } })).toBeNull();
      expect(await listPendingInvitesForUser(invitee.id)).toHaveLength(0);

      const second = await createLeagueInvite(league.id, owner.id, invitee.id);
      await declineLeagueInvite(second.id, invitee.id);
      await revokeLeagueInvite(second.id, owner.id); // no-op, no throw
      const row = await prisma.leagueInvite.findUniqueOrThrow({ where: { id: second.id } });
      expect(row.status).toBe(LeagueInviteStatus.DECLINED);
    });

    it("getLeagueByInviteCode resolves the live code and rejects a rotated one", async () => {
      const owner = await createUser(0);
      const league = await createCustomLeague(owner.id);
      const oldCode = league.inviteCode!;

      const found = await getLeagueByInviteCode(`  ${oldCode.slice(0, 4)}-${oldCode.slice(4)} `);
      expect(found?.id).toBe(league.id);

      await rotateInviteCode(league.id, owner.id);
      expect(await getLeagueByInviteCode(oldCode)).toBeNull();
    });

    it("listInvitableUsers excludes members and already-invited users", async () => {
      const owner = await createUser(0);
      const member = await createUser(0);
      const invited = await createUser(0);
      const fresh = await createUser(0);
      const league = await createCustomLeague(owner.id);
      await joinLeagueByCode(member.id, league.inviteCode!);
      await createLeagueInvite(league.id, owner.id, invited.id);

      const invitable = await listInvitableUsers(league.id);
      const ids = new Set(invitable.map((user) => user.id));
      expect(ids.has(fresh.id)).toBe(true);
      expect(ids.has(owner.id)).toBe(false);
      expect(ids.has(member.id)).toBe(false);
      expect(ids.has(invited.id)).toBe(false);
    });
  });

  it("constrains market categories: canonical slugs for Global, owner-curated per league", async () => {
    const admin = await createUser(0, UserRole.ADMIN);
    const owner = await createUser(0);
    const league = await createCustomLeague(owner.id);
    await startSeason(league.id, owner.id);

    const fields = (category: string) => ({
      title: "Category validation market",
      description: "Exists to exercise the category constraint.",
      category,
      closeTime: new Date(Date.now() + 60 * 60 * 1000),
      resolveTime: new Date(Date.now() + 90 * 60 * 1000),
      resolutionSource: "test",
    });
    const outcomes = [
      { label: "Yes", color: "green" },
      { label: "No", color: "red" },
    ];

    // Global markets take canonical slugs only
    await expect(
      createMarket({ actorId: admin.id, fields: fields("Jokes"), outcomes }),
    ).rejects.toThrow(/categor/i);
    await createMarket({ actorId: admin.id, fields: fields("misc"), outcomes });

    // custom leagues start with ["General"]; other labels need the owner's list
    await expect(
      createMarket({ actorId: owner.id, leagueId: league.id, fields: fields("Trip"), outcomes }),
    ).rejects.toThrow(/categor/i);
    await updateLeagueCategories(league.id, owner.id, ["General", "Trip"]);
    await createMarket({
      actorId: owner.id,
      leagueId: league.id,
      fields: fields("Trip"),
      outcomes,
    });

    // only the owner curates the list, and the Global list is code-fixed
    const member = await createUser(0);
    await joinLeagueByCode(member.id, league.inviteCode!);
    await expect(updateLeagueCategories(league.id, member.id, ["X Y"])).rejects.toThrow(
      /permission/i,
    );
    await expect(
      updateLeagueCategories((await ensureGlobalLeague()).id, admin.id, ["Nope"]),
    ).rejects.toThrow(/fixed in code/i);
  });

  describe("league deletion", () => {
    it("owner deletes a played-out league: full cleanup, trophies and global economy survive", async () => {
      const owner = await createUser(500);
      const member = await createUser(500);
      const league = await createCustomLeague(owner.id);
      await joinLeagueByCode(member.id, league.inviteCode!);
      const season = await startSeason(league.id, owner.id);

      const market = await createMarket({
        actorId: owner.id,
        leagueId: league.id,
        fields: {
          title: "Does the league survive the weekend?",
          description: "Resolves YES if nobody rage-quits before Sunday.",
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
      await resolveMarket(market.id, owner.id, market.outcomes[0].id, "consensus");

      // play the season out so deletion isn't blocked, and so trophies exist
      await prisma.season.update({
        where: { id: season.id },
        data: { endsAt: new Date(Date.now() - 1000) },
      });
      await finalizeDueSeasons(new Date());
      expect(await prisma.userItem.count()).toBe(2);

      await deleteLeague(league.id, owner.id, league.name);

      expect(await prisma.league.findUnique({ where: { id: league.id } })).toBeNull();
      expect(await prisma.season.count({ where: { leagueId: league.id } })).toBe(0);
      expect(await prisma.market.count({ where: { leagueId: league.id } })).toBe(0);
      expect(await prisma.ledgerEntry.count({ where: { leagueId: league.id } })).toBe(0);
      expect(await prisma.leagueMembership.count({ where: { leagueId: league.id } })).toBe(0);

      // trophies are forever; the Global League economy never noticed
      expect(await prisma.userItem.count()).toBe(2);
      expect(await getUserBalance(owner.id)).toBe(500);
      expect(await getUserBalance(member.id)).toBe(500);
    });

    it("refuses an active season, a wrong confirm name, non-owners, and the global league", async () => {
      const owner = await createUser(0);
      const mod = await createUser(0);
      const league = await createCustomLeague(owner.id);
      await joinLeagueByCode(mod.id, league.inviteCode!);
      await setMemberRole(league.id, owner.id, mod.id, LeagueRole.MOD);
      await startSeason(league.id, owner.id);

      await expect(deleteLeague(league.id, owner.id, league.name)).rejects.toThrow(
        /season in progress/i,
      );

      await prisma.season.updateMany({
        where: { leagueId: league.id },
        data: { status: SeasonStatus.FINALIZED },
      });

      await expect(deleteLeague(league.id, owner.id, "Wrong Name")).rejects.toThrow(/exact name/i);
      await expect(deleteLeague(league.id, mod.id, league.name)).rejects.toThrow(/permission/i);

      const admin = await createUser(0, UserRole.ADMIN);
      const global = await ensureGlobalLeague();
      await expect(deleteLeague(global.id, admin.id, global.name)).rejects.toThrow(/global/i);

      expect(await prisma.league.findUnique({ where: { id: league.id } })).not.toBeNull();
    });

    it("app admins can delete any league, and pending invites go with it", async () => {
      const owner = await createUser(0);
      const invitee = await createUser(0);
      const admin = await createUser(0, UserRole.ADMIN);
      const league = await createCustomLeague(owner.id);
      await createLeagueInvite(league.id, owner.id, invitee.id);

      await deleteLeague(league.id, admin.id, league.name);

      expect(await prisma.league.findUnique({ where: { id: league.id } })).toBeNull();
      expect(await prisma.leagueInvite.count({ where: { leagueId: league.id } })).toBe(0);
    });
  });
});
