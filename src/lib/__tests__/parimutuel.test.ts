import { describe, expect, it } from "vitest";
import {
  checkConservation,
  computeCancelRefunds,
  computeRake,
  computeSettlement,
  estimatePayout,
  getOdds,
  type OutcomeStake,
} from "@/lib/parimutuel";

describe("getOdds", () => {
  it("returns the uniform 1/N prior with null multipliers for an empty market", () => {
    const binary = getOdds([0, 0]);
    expect(binary.probabilities).toEqual([0.5, 0.5]);
    expect(binary.multipliers).toEqual([null, null]);

    const triple = getOdds([0, 0, 0]);
    expect(triple.probabilities).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("computes implied probability from pool sizes", () => {
    const odds = getOdds([300, 100]);
    expect(odds.probabilities).toEqual([0.75, 0.25]);
    expect(odds.multipliers[0]).toBeCloseTo(4 / 3);
    expect(odds.multipliers[1]).toBe(4);
  });

  it("handles unbacked outcomes in a multi market", () => {
    const odds = getOdds([200, 0, 100]);
    expect(odds.probabilities).toEqual([2 / 3, 0, 1 / 3]);
    expect(odds.multipliers[1]).toBeNull();
  });

  it("rejects fewer than 2 pools and non-integer pools", () => {
    expect(() => getOdds([100])).toThrow();
    expect(() => getOdds([1.5, 0])).toThrow();
    expect(() => getOdds([-1, 0])).toThrow();
  });
});

describe("computeRake", () => {
  it("floors the rake", () => {
    expect(computeRake(100, 500)).toBe(5);
    expect(computeRake(99, 500)).toBe(4); // 4.95 floors to 4
    expect(computeRake(19, 500)).toBe(0); // sub-1-point rake burns nothing
  });

  it("supports zero rake", () => {
    expect(computeRake(1000, 0)).toBe(0);
  });

  it("rejects out-of-range bps", () => {
    expect(() => computeRake(100, -1)).toThrow();
    expect(() => computeRake(100, 10_001)).toThrow();
    expect(() => computeRake(100, 2.5)).toThrow();
  });
});

describe("computeSettlement", () => {
  it("settles a simple two-user binary market", () => {
    // Casey alone on NO wins the whole YES pool minus rake.
    const stakes: OutcomeStake[] = [
      { userId: "alex", outcomeId: "yes", amount: 300 },
      { userId: "casey", outcomeId: "no", amount: 100 },
    ];

    const result = computeSettlement(stakes, "no", 500);
    expect(result.mode).toBe("NORMAL");
    expect(result.winningPool).toBe(100);
    expect(result.losingPool).toBe(300);
    expect(result.rake).toBe(15);
    expect(result.payouts).toEqual([{ userId: "casey", amount: 385, kind: "PAYOUT", winningStake: 100 }]);
    expect(result.dust).toBe(0);
    expect(checkConservation(result)).toBe(true);
  });

  it("settles a three-outcome market — every losing pool feeds the winners", () => {
    const stakes: OutcomeStake[] = [
      { userId: "alex", outcomeId: "arsenal", amount: 100 },
      { userId: "blair", outcomeId: "draw", amount: 60 },
      { userId: "casey", outcomeId: "chelsea", amount: 140 },
    ];

    // draw wins: W = 60, L = 240, rake = 12, distributable = 228
    const result = computeSettlement(stakes, "draw", 500);
    expect(result.winningPool).toBe(60);
    expect(result.losingPool).toBe(240);
    expect(result.rake).toBe(12);
    expect(result.payouts).toEqual([{ userId: "blair", amount: 288, kind: "PAYOUT", winningStake: 60 }]);
    expect(checkConservation(result)).toBe(true);
  });

  it("splits pro-rata among multiple winners and burns dust", () => {
    const stakes: OutcomeStake[] = [
      { userId: "alex", outcomeId: "yes", amount: 120 },
      { userId: "blair", outcomeId: "no", amount: 200 },
      { userId: "casey", outcomeId: "yes", amount: 30 },
      { userId: "dana", outcomeId: "no", amount: 47 },
    ];

    // L = 247, rake = floor(247*0.05) = 12, distributable = 235, W = 150
    // alex: floor(120*235/150) = 188 ; casey: floor(30*235/150) = 47 ; dust = 0
    const result = computeSettlement(stakes, "yes", 500);
    expect(result.rake).toBe(12);
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 308, kind: "PAYOUT", winningStake: 120 },
      { userId: "casey", amount: 77, kind: "PAYOUT", winningStake: 30 },
    ]);
    expect(result.dust).toBe(0);
    expect(checkConservation(result)).toBe(true);
  });

  it("produces dust when shares do not divide evenly", () => {
    const stakes: OutcomeStake[] = [
      { userId: "a", outcomeId: "yes", amount: 1 },
      { userId: "b", outcomeId: "yes", amount: 1 },
      { userId: "c", outcomeId: "yes", amount: 1 },
      { userId: "d", outcomeId: "no", amount: 100 },
    ];

    // rake = 5, distributable = 95, each winner floor(95/3) = 31, dust = 2
    const result = computeSettlement(stakes, "yes", 500);
    expect(result.payouts.map((p) => p.amount)).toEqual([32, 32, 32]);
    expect(result.dust).toBe(2);
    expect(checkConservation(result)).toBe(true);
  });

  it("groups a user straddling winner and losers into one payout row", () => {
    const stakes: OutcomeStake[] = [
      { userId: "hedger", outcomeId: "arsenal", amount: 100 },
      { userId: "hedger", outcomeId: "draw", amount: 50 },
      { userId: "other", outcomeId: "chelsea", amount: 150 },
    ];

    // arsenal wins: W = 100 (hedger), L = 200 (hedger's draw + other's chelsea)
    // rake = 10, distributable = 190 → hedger gets 100 + 190 = 290, one row
    const result = computeSettlement(stakes, "arsenal", 500);
    expect(result.payouts).toEqual([{ userId: "hedger", amount: 290, kind: "PAYOUT", winningStake: 100 }]);
    expect(checkConservation(result)).toBe(true);
  });

  it("never pays a winner less than their winning stake", () => {
    const stakes: OutcomeStake[] = [
      { userId: "tiny", outcomeId: "yes", amount: 1 },
      { userId: "whale", outcomeId: "yes", amount: 499 },
      { userId: "loser", outcomeId: "no", amount: 3 },
    ];

    const result = computeSettlement(stakes, "yes", 500);
    for (const payout of result.payouts) {
      const stake = stakes.find((s) => s.userId === payout.userId)!;
      expect(payout.amount).toBeGreaterThanOrEqual(stake.amount);
    }
  });

  it("refunds everyone with no rake when nobody backed the winner", () => {
    const stakes: OutcomeStake[] = [
      { userId: "alex", outcomeId: "arsenal", amount: 200 },
      { userId: "blair", outcomeId: "chelsea", amount: 100 },
    ];

    const result = computeSettlement(stakes, "draw", 500);
    expect(result.mode).toBe("REFUND_ALL");
    expect(result.rake).toBe(0);
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 200, kind: "REFUND", winningStake: 0 },
      { userId: "blair", amount: 100, kind: "REFUND", winningStake: 0 },
    ]);
    expect(checkConservation(result)).toBe(true);
  });

  it("returns exact stakes when every other pool is empty", () => {
    const stakes: OutcomeStake[] = [
      { userId: "alex", outcomeId: "yes", amount: 200 },
      { userId: "blair", outcomeId: "yes", amount: 50 },
    ];

    const result = computeSettlement(stakes, "yes", 500);
    expect(result.mode).toBe("NORMAL");
    expect(result.rake).toBe(0);
    expect(result.dust).toBe(0);
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 200, kind: "PAYOUT", winningStake: 200 },
      { userId: "blair", amount: 50, kind: "PAYOUT", winningStake: 50 },
    ]);
  });

  it("handles an empty market", () => {
    const result = computeSettlement([], "yes", 500);
    expect(result.mode).toBe("EMPTY");
    expect(result.payouts).toEqual([]);
    expect(result.totalIn).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    const stakes: OutcomeStake[] = [
      { userId: "zed", outcomeId: "yes", amount: 33 },
      { userId: "amy", outcomeId: "yes", amount: 67 },
      { userId: "mid", outcomeId: "no", amount: 101 },
    ];

    const a = computeSettlement(stakes, "yes", 500);
    const b = computeSettlement([...stakes].reverse(), "yes", 500);
    expect(a).toEqual(b);
    expect(a.payouts[0].userId).toBe("amy");
  });

  it("rejects fractional and negative stakes", () => {
    expect(() =>
      computeSettlement([{ userId: "x", outcomeId: "yes", amount: 1.5 }], "yes", 500),
    ).toThrow();
    expect(() =>
      computeSettlement([{ userId: "x", outcomeId: "yes", amount: -5 }], "yes", 500),
    ).toThrow();
  });
});

describe("computeCancelRefunds", () => {
  it("refunds every outcome of every stake in one row per user", () => {
    const stakes: OutcomeStake[] = [
      { userId: "alex", outcomeId: "arsenal", amount: 120 },
      { userId: "alex", outcomeId: "draw", amount: 30 },
      { userId: "blair", outcomeId: "chelsea", amount: 75 },
      { userId: "idle", outcomeId: "arsenal", amount: 0 },
    ];

    const result = computeCancelRefunds(stakes);
    expect(result.mode).toBe("REFUND_ALL");
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 150, kind: "REFUND", winningStake: 0 },
      { userId: "blair", amount: 75, kind: "REFUND", winningStake: 0 },
    ]);
    expect(checkConservation(result)).toBe(true);
  });

  it("handles no stakes", () => {
    expect(computeCancelRefunds([]).mode).toBe("EMPTY");
  });
});

describe("estimatePayout", () => {
  it("matches settlement for a single winner", () => {
    // pools after my 100-point bet: mine 100 (all me), everything else 300
    const estimate = estimatePayout({ stake: 100, winningPool: 100, losingPool: 300, rakeBps: 500 });
    const settled = computeSettlement(
      [
        { userId: "me", outcomeId: "a", amount: 100 },
        { userId: "them", outcomeId: "b", amount: 200 },
        { userId: "them2", outcomeId: "c", amount: 100 },
      ],
      "a",
      500,
    );
    expect(estimate).toBe(settled.payouts[0].amount);
  });

  it("returns 0 for a zero stake", () => {
    expect(estimatePayout({ stake: 0, winningPool: 100, losingPool: 100, rakeBps: 500 })).toBe(0);
  });

  it("rejects a stake larger than its pool", () => {
    expect(() =>
      estimatePayout({ stake: 200, winningPool: 100, losingPool: 0, rakeBps: 500 }),
    ).toThrow();
  });
});

describe("conservation fuzzing", () => {
  // deterministic PRNG so failures are reproducible
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

  it("holds conservation and payout floors across 2000 random N-outcome markets", () => {
    const rand = mulberry32(0xf00d);

    for (let i = 0; i < 2000; i += 1) {
      const outcomeCount = 2 + Math.floor(rand() * 5); // 2..6
      const outcomes = Array.from({ length: outcomeCount }, (_, o) => `outcome-${o}`);
      const userCount = 1 + Math.floor(rand() * 40);

      // users can straddle any subset of outcomes
      const stakes: OutcomeStake[] = [];
      for (let u = 0; u < userCount; u += 1) {
        for (const outcomeId of outcomes) {
          if (rand() < 0.4) {
            stakes.push({
              userId: `user-${String(u).padStart(2, "0")}`,
              outcomeId,
              amount: Math.floor(rand() * 501),
            });
          }
        }
      }

      const winner = outcomes[Math.floor(rand() * outcomeCount)];
      const rakeBps = Math.floor(rand() * 2001);

      const result = computeSettlement(stakes, winner, rakeBps);

      // exact conservation: every point in is accounted for
      expect(checkConservation(result)).toBe(true);

      // all outputs are safe non-negative integers
      for (const payout of result.payouts) {
        expect(Number.isSafeInteger(payout.amount)).toBe(true);
        expect(payout.amount).toBeGreaterThanOrEqual(0);
      }
      expect(result.rake).toBeGreaterThanOrEqual(0);
      expect(result.dust).toBeGreaterThanOrEqual(0);

      if (result.mode === "NORMAL") {
        // winners never take home less than their winning stake — even when
        // they also hold losing outcomes — and the row's winningStake
        // snapshot matches the raw stakes (the rake→gems pro-rata basis)
        for (const payout of result.payouts) {
          const winningStake = stakes
            .filter((s) => s.userId === payout.userId && s.outcomeId === winner)
            .reduce((sum, s) => sum + s.amount, 0);
          expect(payout.amount).toBeGreaterThanOrEqual(winningStake);
          expect(payout.winningStake).toBe(winningStake);
        }
        // dust is bounded by winners - 1 rounding losses of < 1 point each
        expect(result.dust).toBeLessThanOrEqual(Math.max(result.payouts.length - 1, 0));
      }

      if (result.mode === "REFUND_ALL") {
        expect(result.rake).toBe(0);
        expect(result.totalOut).toBe(result.totalIn);
        // one refund row per distinct staked user
        const stakedUsers = new Set(stakes.filter((s) => s.amount > 0).map((s) => s.userId));
        expect(result.payouts).toHaveLength(stakedUsers.size);
      }
    }
  });

  it("cancel refunds conserve across 500 random N-outcome markets", () => {
    const rand = mulberry32(0xbeef);

    for (let i = 0; i < 500; i += 1) {
      const outcomeCount = 2 + Math.floor(rand() * 5);
      const stakes: OutcomeStake[] = [];
      for (let u = 0; u < 1 + Math.floor(rand() * 20); u += 1) {
        for (let o = 0; o < outcomeCount; o += 1) {
          if (rand() < 0.5) {
            stakes.push({ userId: `user-${u}`, outcomeId: `outcome-${o}`, amount: Math.floor(rand() * 300) });
          }
        }
      }

      const result = computeCancelRefunds(stakes);
      expect(checkConservation(result)).toBe(true);
      expect(result.totalOut).toBe(result.totalIn);
    }
  });
});
