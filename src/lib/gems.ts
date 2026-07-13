import { GemLedgerEntryType } from "@prisma/client";
import { assertSafeInt } from "@/lib/parimutuel";

/**
 * Rake→gems conversion (Phase 3, decision #5): a settled Global League
 * market's points-rake is minted 1:1 as gems and split pro-rata across the
 * winners by winning stake. The points-rake itself is still burned — gems are
 * a parallel meta-currency, so the points inflation sink is untouched.
 */
export type GemGrantRow = { userId: string; gems: number };

export type RakeGemSplit = {
  grants: GemGrantRow[];
  // floor-rounding remainder, dropped (never minted) — the gems analog of
  // settlement dust
  gemDust: number;
  rake: number;
};

export function computeRakeGemSplit(
  winners: Array<{ userId: string; winningStake: number }>,
  rake: number,
): RakeGemSplit {
  assertSafeInt(rake, "Rake");
  for (const row of winners) {
    assertSafeInt(row.winningStake, `Winning stake for ${row.userId}`);
  }

  const winningPool = winners.reduce((sum, row) => sum + row.winningStake, 0);

  if (rake === 0 || winningPool === 0) {
    return { grants: [], gemDust: rake, rake };
  }

  const grants: GemGrantRow[] = [];
  let minted = 0;

  for (const row of winners) {
    const gems = Math.floor((row.winningStake * rake) / winningPool);
    if (gems === 0) {
      continue;
    }
    minted += gems;
    grants.push({ userId: row.userId, gems });
  }

  const split: RakeGemSplit = { grants, gemDust: rake - minted, rake };

  if (!checkGemConservation(split)) {
    throw new Error("Gem split failed conservation check.");
  }

  return split;
}

/** Invariant: every rake point is either minted as gems or dropped as dust. */
export function checkGemConservation(split: RakeGemSplit) {
  const minted = split.grants.reduce((sum, row) => sum + row.gems, 0);
  return minted >= 0 && split.gemDust >= 0 && minted + split.gemDust === split.rake;
}

export type GemBreakdown = {
  rakeEarned: number;
  achievements: number;
  placements: number;
  adjustments: number;
  spent: number;
};

const EMPTY_BREAKDOWN: GemBreakdown = {
  rakeEarned: 0,
  achievements: 0,
  placements: 0,
  adjustments: 0,
  spent: 0,
};

export function categorizeGemAmount(type: GemLedgerEntryType, amount: number): GemBreakdown {
  switch (type) {
    case GemLedgerEntryType.RAKE_CONVERSION:
      return { ...EMPTY_BREAKDOWN, rakeEarned: amount };
    case GemLedgerEntryType.ACHIEVEMENT:
      return { ...EMPTY_BREAKDOWN, achievements: amount };
    case GemLedgerEntryType.SEASON_PLACEMENT:
      return { ...EMPTY_BREAKDOWN, placements: amount };
    case GemLedgerEntryType.ADMIN_ADJUST:
      return { ...EMPTY_BREAKDOWN, adjustments: amount };
    case GemLedgerEntryType.STORE_PURCHASE:
      return { ...EMPTY_BREAKDOWN, spent: Math.abs(amount) };
  }
}

export function buildGemBreakdown(entries: Array<{ type: GemLedgerEntryType; amount: number }>) {
  return entries.reduce<GemBreakdown>((totals, entry) => {
    const contribution = categorizeGemAmount(entry.type, entry.amount);
    return {
      rakeEarned: totals.rakeEarned + contribution.rakeEarned,
      achievements: totals.achievements + contribution.achievements,
      placements: totals.placements + contribution.placements,
      adjustments: totals.adjustments + contribution.adjustments,
      spent: totals.spent + contribution.spent,
    };
  }, EMPTY_BREAKDOWN);
}

export function reconcileGemBalanceFromBreakdown(breakdown: GemBreakdown) {
  const balance =
    breakdown.rakeEarned +
    breakdown.achievements +
    breakdown.placements +
    breakdown.adjustments -
    breakdown.spent;
  assertSafeInt(Math.abs(balance), "Reconciled gem balance");
  return balance;
}
