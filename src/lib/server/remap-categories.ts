/**
 * One-time Global League category remap: free-text categories → canonical
 * slugs (src/lib/categories.ts), followed by a full achievement re-evaluation
 * so historical wins count toward the new category tiers. The 48h cron sweep
 * never reaches old markets, hence the explicit pass — same reasoning as the
 * gem launch backfill.
 *
 * Dry-run by default: prints the remap plan and the exact achievement grants
 * (with gem totals — this is real issuance) without writing. Re-runnable:
 * already-canonical values are left alone and the achievement pass uses the
 * same [userId, achievementKey] idempotency as the live path.
 *
 * The old→canonical mapping is authored at run time in `MAPPING` below;
 * anything unmapped falls to Misc (which earns nothing).
 */
import { MarketStatus } from "@prisma/client";
import {
  ACHIEVEMENTS_BY_KEY,
  evaluateAchievements,
  type AchievementKey,
} from "@/lib/achievements";
import { isGlobalCategory } from "@/lib/categories";
import { prisma } from "@/lib/prisma";
import { getUserResolvedHistory, evaluateUserAchievements } from "@/lib/server/achievement-service";
import { ensureGlobalLeague } from "@/lib/server/league-service";

/** Author this against prod's actual values before running with --execute. */
const MAPPING: Record<string, string> = {
  Sports: "sports",
  Weather: "weather",
  Music: "pop-culture",
  Friends: "misc",
  // the escape-hatch slug shipped briefly as "wildcard" before renaming to misc
  wildcard: "misc",
};

function targetFor(category: string) {
  if (isGlobalCategory(category)) {
    return category; // already canonical — leave it alone
  }
  return MAPPING[category] ?? "misc";
}

export async function runCategoryRemap({ execute }: { execute: boolean }) {
  const globalLeague = await ensureGlobalLeague();

  const groups = await prisma.market.groupBy({
    by: ["category"],
    where: { leagueId: globalLeague.id },
    _count: { _all: true },
    orderBy: { category: "asc" },
  });

  console.log(`${execute ? "EXECUTING" : "DRY RUN"} — Global League category remap\n`);
  const changes = groups.filter((group) => targetFor(group.category) !== group.category);
  for (const group of groups) {
    const target = targetFor(group.category);
    const marker = target === group.category ? "  =" : "  →";
    const unmapped = target === "misc" && !(group.category in MAPPING) && !isGlobalCategory(group.category);
    console.log(
      `${marker} ${group.category} → ${target} (${group._count._all} markets)${unmapped ? "  [UNMAPPED — defaulting to misc]" : ""}`,
    );
  }

  // prospective achievement grants, computed against the post-remap categories
  // (in-memory during a dry run) and diffed against what's already granted
  const stakers = await prisma.poolStake.findMany({
    where: { market: { leagueId: globalLeague.id, status: MarketStatus.RESOLVED } },
    select: { userId: true },
    distinct: ["userId"],
  });

  let totalGems = 0;
  let totalGrants = 0;
  console.log("\nProspective achievement grants:");
  for (const { userId } of stakers) {
    const history = await getUserResolvedHistory(userId);
    const remapped = history.map((fact) => ({ ...fact, category: targetFor(fact.category) }));
    const earned = new Set(evaluateAchievements(remapped));
    const existing = await prisma.gemLedgerEntry.findMany({
      where: { userId, type: "ACHIEVEMENT" },
      select: { achievementKey: true },
    });
    const existingKeys = new Set(existing.map((entry) => entry.achievementKey));
    const missing = [...earned].filter((key) => !existingKeys.has(key)) as AchievementKey[];
    if (missing.length === 0) {
      continue;
    }
    const gems = missing.reduce((sum, key) => sum + (ACHIEVEMENTS_BY_KEY.get(key)?.gems ?? 0), 0);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    console.log(`  ${user?.username ?? userId}: ${missing.join(", ")} (+${gems} gems)`);
    totalGems += gems;
    totalGrants += missing.length;
  }
  console.log(`  TOTAL: ${totalGrants} grants, ${totalGems} gems minted retroactively`);

  if (!execute) {
    console.log("\nDry run — nothing written. Re-run with --execute to apply.");
    return;
  }

  for (const group of changes) {
    const target = targetFor(group.category);
    const result = await prisma.market.updateMany({
      where: { leagueId: globalLeague.id, category: group.category },
      data: { category: target },
    });
    console.log(`remapped ${result.count} markets: ${group.category} → ${target}`);
  }

  let granted = 0;
  for (const { userId } of stakers) {
    granted += (await evaluateUserAchievements(userId)).length;
  }
  console.log(`\nDone. Achievement pass granted ${granted} achievements.`);
}
