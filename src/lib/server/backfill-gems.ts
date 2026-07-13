/**
 * The Phase 3 launch backfill (decision: full backfill): converts the rake of
 * every already-settled Global League market into gems, grants placement gems
 * for past finalized Global seasons, and evaluates achievement history for
 * every participant. Wholly re-runnable — every write uses the same
 * idempotency keys as the live paths (partial uniques on rake/placement rows,
 * [userId, achievementKey], badge grantKeys), so live + backfill can never
 * double-grant. Invoked by `npm run backfill-gems` (scripts/backfill-gems.ts).
 */
import { GemLedgerEntryType, MarketStatus, SeasonStatus, UserStatus } from "@prisma/client";
import { GEM_STARTING_GRANT } from "@/lib/achievements";
import { computeRakeGemSplit } from "@/lib/gems";
import { computeSettlement } from "@/lib/parimutuel";
import { prisma } from "@/lib/prisma";
import {
  ensureAchievementItems,
  evaluateUserAchievements,
} from "@/lib/server/achievement-service";
import { grantPlacementGems, grantStartingGems } from "@/lib/server/gem-service";
import { ensureGlobalLeague } from "@/lib/server/league-service";

export async function backfillRakeConversions(globalLeagueId: string) {
  const markets = await prisma.market.findMany({
    where: {
      leagueId: globalLeagueId,
      status: MarketStatus.RESOLVED,
      resolution: { rakeAmount: { gt: 0 } },
    },
    include: {
      resolution: true,
      poolStakes: { select: { userId: true, outcomeId: true, amount: true } },
    },
  });

  let converted = 0;
  let skipped = 0;
  let alreadyDone = 0;
  let gemsMinted = 0;

  for (const market of markets) {
    const resolution = market.resolution!;
    if (!market.winningOutcomeId) {
      skipped += 1;
      console.warn(`skip ${market.id} (${market.title}): RESOLVED but no winning outcome`);
      continue;
    }

    // deterministic replay from the persisted stakes; the cross-check catches
    // any market whose stakes no longer reconstruct the recorded settlement
    // (e.g. a cascade-deleted user's rows) — skip + log, never guess
    const result = computeSettlement(market.poolStakes, market.winningOutcomeId, market.rakeBps);
    if (result.rake !== resolution.rakeAmount || result.winningPool !== resolution.winningPool) {
      skipped += 1;
      console.warn(
        `skip ${market.id} (${market.title}): replay mismatch ` +
          `(rake ${result.rake} vs ${resolution.rakeAmount}, W ${result.winningPool} vs ${resolution.winningPool})`,
      );
      continue;
    }

    const split = computeRakeGemSplit(
      result.payouts
        .filter((payout) => payout.kind === "PAYOUT")
        .map((payout) => ({ userId: payout.userId, winningStake: payout.winningStake })),
      result.rake,
    );

    if (split.grants.length === 0) {
      alreadyDone += 1;
      continue;
    }

    // ON CONFLICT DO NOTHING via the partial unique — re-runs are no-ops
    const created = await prisma.gemLedgerEntry.createMany({
      data: split.grants.map((grant) => ({
        userId: grant.userId,
        type: GemLedgerEntryType.RAKE_CONVERSION,
        amount: grant.gems,
        marketId: market.id,
        description: `Rake conversion — ${market.title}`,
      })),
      skipDuplicates: true,
    });

    const minted = split.rake - split.gemDust;
    if (resolution.gemsMinted !== minted) {
      await prisma.marketResolution.update({
        where: { marketId: market.id },
        data: { gemsMinted: minted },
      });
    }

    if (created.count > 0) {
      converted += 1;
      gemsMinted += split.grants.reduce((sum, grant) => sum + grant.gems, 0);
    } else {
      alreadyDone += 1;
    }
  }

  return { markets: markets.length, converted, skipped, alreadyDone, gemsMinted };
}

type FrozenStandingRow = { userId?: unknown; rank?: unknown };

export async function backfillPlacements(globalLeagueId: string) {
  const seasons = await prisma.season.findMany({
    where: { leagueId: globalLeagueId, status: SeasonStatus.FINALIZED },
    include: { league: { select: { name: true } } },
  });

  let granted = 0;
  for (const season of seasons) {
    if (!Array.isArray(season.standings)) {
      continue;
    }
    for (const raw of season.standings as FrozenStandingRow[]) {
      if (!raw || typeof raw.userId !== "string" || typeof raw.rank !== "number" || raw.rank > 3) {
        continue;
      }
      const created = await grantPlacementGems({
        userId: raw.userId,
        seasonId: season.id,
        rank: raw.rank,
        seasonName: season.name,
        leagueName: season.league.name,
      });
      if (created) {
        granted += 1;
      }
    }
  }

  return { seasons: seasons.length, granted };
}

export async function backfillAchievements(globalLeagueId: string) {
  await ensureAchievementItems();

  const participants = await prisma.poolStake.findMany({
    where: { market: { leagueId: globalLeagueId, status: MarketStatus.RESOLVED } },
    select: { userId: true },
    distinct: ["userId"],
  });

  let usersGranted = 0;
  let grants = 0;
  for (const { userId } of participants) {
    const granted = await evaluateUserAchievements(userId);
    if (granted.length > 0) {
      usersGranted += 1;
      grants += granted.length;
    }
  }

  return { participants: participants.length, usersGranted, grants };
}

/** The one-time 1000-gem starting allowance for every existing ACTIVE member. */
export async function backfillStartingGrants() {
  const users = await prisma.user.findMany({
    where: { status: UserStatus.ACTIVE },
    select: { id: true },
  });

  let granted = 0;
  for (const user of users) {
    if (await grantStartingGems(user.id)) {
      granted += 1;
    }
  }

  return { users: users.length, granted };
}

export async function runGemBackfill(log: (message: string) => void = console.log) {
  const globalLeague = await ensureGlobalLeague();

  log("Granting starting allowances…");
  const starting = await backfillStartingGrants();
  log(
    `  ${starting.users} active members: ${starting.granted} new starting grants of ${GEM_STARTING_GRANT} gems`,
  );

  log("Backfilling rake conversions…");
  const rake = await backfillRakeConversions(globalLeague.id);
  log(
    `  ${rake.markets} raked markets: ${rake.converted} converted (+${rake.gemsMinted} gems), ` +
      `${rake.alreadyDone} already done/no-op, ${rake.skipped} skipped (see warnings)`,
  );

  log("Backfilling season placement gems…");
  const placements = await backfillPlacements(globalLeague.id);
  log(`  ${placements.seasons} finalized seasons: ${placements.granted} new placement grants`);

  log("Backfilling achievements…");
  const achievements = await backfillAchievements(globalLeague.id);
  log(
    `  ${achievements.participants} participants: ${achievements.grants} achievements granted ` +
      `across ${achievements.usersGranted} users`,
  );

  log("Done. Safe to re-run; a clean re-run reports 0 new grants everywhere.");
  return { starting, rake, placements, achievements };
}
