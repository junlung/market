import { GemLedgerEntryType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildGemBreakdown,
  checkGemConservation,
  computeRakeGemSplit,
  reconcileGemBalanceFromBreakdown,
} from "@/lib/gems";
import { computeSettlement, type OutcomeStake } from "@/lib/parimutuel";

describe("computeRakeGemSplit", () => {
  it("gives a lone winner the whole rake", () => {
    const split = computeRakeGemSplit([{ userId: "casey", winningStake: 100 }], 15);
    expect(split.grants).toEqual([{ userId: "casey", gems: 15 }]);
    expect(split.gemDust).toBe(0);
    expect(checkGemConservation(split)).toBe(true);
  });

  it("splits pro-rata by winning stake and floors", () => {
    // rake 12 over W = 150: alex floor(120*12/150) = 9, casey floor(30*12/150) = 2, dust 1
    const split = computeRakeGemSplit(
      [
        { userId: "alex", winningStake: 120 },
        { userId: "casey", winningStake: 30 },
      ],
      12,
    );
    expect(split.grants).toEqual([
      { userId: "alex", gems: 9 },
      { userId: "casey", gems: 2 },
    ]);
    expect(split.gemDust).toBe(1);
    expect(checkGemConservation(split)).toBe(true);
  });

  it("drops zero-gem winners and turns a sub-winner-count rake into pure dust", () => {
    // rake 2 across 3 equal winners: floor(2/3) = 0 each — nothing mints
    const split = computeRakeGemSplit(
      [
        { userId: "a", winningStake: 1 },
        { userId: "b", winningStake: 1 },
        { userId: "c", winningStake: 1 },
      ],
      2,
    );
    expect(split.grants).toEqual([]);
    expect(split.gemDust).toBe(2);
    expect(checkGemConservation(split)).toBe(true);
  });

  it("no-ops on zero rake and on no winners (refund/cancel paths)", () => {
    expect(computeRakeGemSplit([{ userId: "a", winningStake: 100 }], 0)).toEqual({
      grants: [],
      gemDust: 0,
      rake: 0,
    });
    expect(computeRakeGemSplit([], 15)).toEqual({ grants: [], gemDust: 15, rake: 15 });
  });

  it("rejects fractional and negative inputs", () => {
    expect(() => computeRakeGemSplit([{ userId: "a", winningStake: 1.5 }], 10)).toThrow();
    expect(() => computeRakeGemSplit([{ userId: "a", winningStake: -1 }], 10)).toThrow();
    expect(() => computeRakeGemSplit([{ userId: "a", winningStake: 1 }], -10)).toThrow();
  });

  it("conserves every rake point across random settlements", () => {
    // deterministic PRNG, same shape as the parimutuel fuzz
    function mulberry32(seed: number) {
      let a = seed;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(0x9e35);

    for (let i = 0; i < 1000; i += 1) {
      const stakes: OutcomeStake[] = [];
      for (let u = 0; u < 1 + Math.floor(rand() * 20); u += 1) {
        for (const outcomeId of ["a", "b", "c"]) {
          if (rand() < 0.5) {
            stakes.push({ userId: `user-${u}`, outcomeId, amount: Math.floor(rand() * 400) });
          }
        }
      }

      const result = computeSettlement(stakes, "a", Math.floor(rand() * 2001));
      const winners = result.payouts
        .filter((p) => p.kind === "PAYOUT")
        .map((p) => ({ userId: p.userId, winningStake: p.winningStake }));
      const split = computeRakeGemSplit(winners, result.rake);

      expect(checkGemConservation(split)).toBe(true);
      for (const grant of split.grants) {
        expect(Number.isSafeInteger(grant.gems)).toBe(true);
        expect(grant.gems).toBeGreaterThan(0);
      }
      // gems minted never exceed the rake
      expect(split.grants.reduce((sum, g) => sum + g.gems, 0)).toBeLessThanOrEqual(result.rake);
    }
  });
});

describe("gem breakdown", () => {
  it("categorizes and reconciles a mixed ledger", () => {
    const entries = [
      { type: GemLedgerEntryType.RAKE_CONVERSION, amount: 40 },
      { type: GemLedgerEntryType.ACHIEVEMENT, amount: 25 },
      { type: GemLedgerEntryType.SEASON_PLACEMENT, amount: 100 },
      { type: GemLedgerEntryType.ADMIN_ADJUST, amount: -5 },
      { type: GemLedgerEntryType.STORE_PURCHASE, amount: -75 },
    ];

    const breakdown = buildGemBreakdown(entries);
    expect(breakdown).toEqual({
      rakeEarned: 40,
      achievements: 25,
      placements: 100,
      adjustments: -5,
      spent: 75,
    });
    expect(reconcileGemBalanceFromBreakdown(breakdown)).toBe(85);
  });
});
