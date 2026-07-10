import { describe, expect, it } from "vitest";
import {
  checkConservation,
  computeCancelRefunds,
  computeRake,
  computeSettlement,
  estimatePayout,
  getOdds,
  type StakeRow,
} from "@/lib/parimutuel";

describe("getOdds", () => {
  it("returns 50/50 with null multipliers for an empty market", () => {
    const odds = getOdds({ yesPool: 0, noPool: 0 });
    expect(odds.yesProbability).toBe(0.5);
    expect(odds.noProbability).toBe(0.5);
    expect(odds.yesMultiplier).toBeNull();
    expect(odds.noMultiplier).toBeNull();
  });

  it("computes implied probability from pool sizes", () => {
    const odds = getOdds({ yesPool: 300, noPool: 100 });
    expect(odds.yesProbability).toBe(0.75);
    expect(odds.noProbability).toBe(0.25);
    expect(odds.yesMultiplier).toBeCloseTo(4 / 3);
    expect(odds.noMultiplier).toBe(4);
  });

  it("handles a one-sided market", () => {
    const odds = getOdds({ yesPool: 200, noPool: 0 });
    expect(odds.yesProbability).toBe(1);
    expect(odds.noMultiplier).toBeNull();
  });

  it("rejects non-integer pools", () => {
    expect(() => getOdds({ yesPool: 1.5, noPool: 0 })).toThrow();
    expect(() => getOdds({ yesPool: -1, noPool: 0 })).toThrow();
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
  it("settles a simple two-user market", () => {
    // Casey alone on NO wins the whole YES pool minus rake.
    const stakes: StakeRow[] = [
      { userId: "alex", yesStake: 300, noStake: 0 },
      { userId: "casey", yesStake: 0, noStake: 100 },
    ];

    const result = computeSettlement(stakes, "NO", 500);
    expect(result.mode).toBe("NORMAL");
    expect(result.winningPool).toBe(100);
    expect(result.losingPool).toBe(300);
    expect(result.rake).toBe(15);
    expect(result.payouts).toEqual([{ userId: "casey", amount: 385, kind: "PAYOUT" }]);
    expect(result.dust).toBe(0);
    expect(checkConservation(result)).toBe(true);
  });

  it("splits pro-rata among multiple winners and burns dust", () => {
    const stakes: StakeRow[] = [
      { userId: "alex", yesStake: 120, noStake: 0 },
      { userId: "blair", yesStake: 0, noStake: 200 },
      { userId: "casey", yesStake: 30, noStake: 0 },
      { userId: "dana", yesStake: 0, noStake: 47 },
    ];

    // L = 247, rake = floor(247*0.05) = 12, distributable = 235, W = 150
    // alex: floor(120*235/150) = 188 ; casey: floor(30*235/150) = 47 ; dust = 0
    const result = computeSettlement(stakes, "YES", 500);
    expect(result.rake).toBe(12);
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 308, kind: "PAYOUT" },
      { userId: "casey", amount: 77, kind: "PAYOUT" },
    ]);
    expect(result.dust).toBe(0);
    expect(checkConservation(result)).toBe(true);
  });

  it("produces dust when shares do not divide evenly", () => {
    const stakes: StakeRow[] = [
      { userId: "a", yesStake: 1, noStake: 0 },
      { userId: "b", yesStake: 1, noStake: 0 },
      { userId: "c", yesStake: 1, noStake: 0 },
      { userId: "d", yesStake: 0, noStake: 100 },
    ];

    // rake = 5, distributable = 95, each winner floor(95/3) = 31, dust = 2
    const result = computeSettlement(stakes, "YES", 500);
    expect(result.payouts.map((p) => p.amount)).toEqual([32, 32, 32]);
    expect(result.dust).toBe(2);
    expect(checkConservation(result)).toBe(true);
  });

  it("never pays a winner less than their stake", () => {
    const stakes: StakeRow[] = [
      { userId: "tiny", yesStake: 1, noStake: 0 },
      { userId: "whale", yesStake: 499, noStake: 0 },
      { userId: "loser", yesStake: 0, noStake: 3 },
    ];

    const result = computeSettlement(stakes, "YES", 500);
    for (const payout of result.payouts) {
      const stake = stakes.find((s) => s.userId === payout.userId)!;
      expect(payout.amount).toBeGreaterThanOrEqual(stake.yesStake);
    }
  });

  it("pays the winning-side stake of a both-sides bettor; losing side stays in L", () => {
    const stakes: StakeRow[] = [
      { userId: "hedger", yesStake: 100, noStake: 50 },
      { userId: "other", yesStake: 0, noStake: 150 },
    ];

    // W = 100 (hedger YES), L = 200, rake = 10, distributable = 190
    const result = computeSettlement(stakes, "YES", 500);
    expect(result.payouts).toEqual([{ userId: "hedger", amount: 290, kind: "PAYOUT" }]);
    expect(checkConservation(result)).toBe(true);
    // hedging is strictly worse than not betting the losing side (290 < 100 + 50 + ...)
  });

  it("refunds everyone with no rake when nobody backed the winner", () => {
    const stakes: StakeRow[] = [
      { userId: "alex", yesStake: 200, noStake: 0 },
      { userId: "blair", yesStake: 100, noStake: 0 },
    ];

    const result = computeSettlement(stakes, "NO", 500);
    expect(result.mode).toBe("REFUND_ALL");
    expect(result.rake).toBe(0);
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 200, kind: "REFUND" },
      { userId: "blair", amount: 100, kind: "REFUND" },
    ]);
    expect(checkConservation(result)).toBe(true);
  });

  it("returns exact stakes when the losing pool is empty", () => {
    const stakes: StakeRow[] = [
      { userId: "alex", yesStake: 200, noStake: 0 },
      { userId: "blair", yesStake: 50, noStake: 0 },
    ];

    const result = computeSettlement(stakes, "YES", 500);
    expect(result.mode).toBe("NORMAL");
    expect(result.rake).toBe(0);
    expect(result.dust).toBe(0);
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 200, kind: "PAYOUT" },
      { userId: "blair", amount: 50, kind: "PAYOUT" },
    ]);
  });

  it("handles an empty market", () => {
    const result = computeSettlement([], "YES", 500);
    expect(result.mode).toBe("EMPTY");
    expect(result.payouts).toEqual([]);
    expect(result.totalIn).toBe(0);
  });

  it("is deterministic regardless of input order", () => {
    const stakes: StakeRow[] = [
      { userId: "zed", yesStake: 33, noStake: 0 },
      { userId: "amy", yesStake: 67, noStake: 0 },
      { userId: "mid", yesStake: 0, noStake: 101 },
    ];

    const a = computeSettlement(stakes, "YES", 500);
    const b = computeSettlement([...stakes].reverse(), "YES", 500);
    expect(a).toEqual(b);
    expect(a.payouts[0].userId).toBe("amy");
  });

  it("rejects fractional and negative stakes", () => {
    expect(() =>
      computeSettlement([{ userId: "x", yesStake: 1.5, noStake: 0 }], "YES", 500),
    ).toThrow();
    expect(() =>
      computeSettlement([{ userId: "x", yesStake: -5, noStake: 0 }], "YES", 500),
    ).toThrow();
  });
});

describe("computeCancelRefunds", () => {
  it("refunds both sides of every stake", () => {
    const stakes: StakeRow[] = [
      { userId: "alex", yesStake: 120, noStake: 30 },
      { userId: "blair", yesStake: 0, noStake: 75 },
      { userId: "idle", yesStake: 0, noStake: 0 },
    ];

    const result = computeCancelRefunds(stakes);
    expect(result.mode).toBe("REFUND_ALL");
    expect(result.payouts).toEqual([
      { userId: "alex", amount: 150, kind: "REFUND" },
      { userId: "blair", amount: 75, kind: "REFUND" },
    ]);
    expect(checkConservation(result)).toBe(true);
  });

  it("handles no stakes", () => {
    expect(computeCancelRefunds([]).mode).toBe("EMPTY");
  });
});

describe("estimatePayout", () => {
  it("matches settlement for a single winner", () => {
    // pools after my 100-point YES bet: yes 100 (all mine), no 300
    const estimate = estimatePayout({ stake: 100, winningPool: 100, losingPool: 300, rakeBps: 500 });
    const settled = computeSettlement(
      [
        { userId: "me", yesStake: 100, noStake: 0 },
        { userId: "them", yesStake: 0, noStake: 300 },
      ],
      "YES",
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

  it("holds conservation and payout floors across 2000 random markets", () => {
    const rand = mulberry32(0xf00d);

    for (let i = 0; i < 2000; i += 1) {
      const userCount = 1 + Math.floor(rand() * 40);
      const stakes: StakeRow[] = Array.from({ length: userCount }, (_, u) => ({
        userId: `user-${String(u).padStart(2, "0")}`,
        yesStake: Math.floor(rand() * 501) * (rand() < 0.7 ? 1 : 0),
        noStake: Math.floor(rand() * 501) * (rand() < 0.7 ? 1 : 0),
      }));
      const outcome = rand() < 0.5 ? "YES" : "NO";
      const rakeBps = Math.floor(rand() * 2001);

      const result = computeSettlement(stakes, outcome, rakeBps);

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
        // winners never take home less than their winning stake
        for (const payout of result.payouts) {
          const row = stakes.find((s) => s.userId === payout.userId)!;
          const stake = outcome === "YES" ? row.yesStake : row.noStake;
          expect(payout.amount).toBeGreaterThanOrEqual(stake);
        }
        // dust is bounded by the number of winners (each floor loses < 1 point)
        expect(result.dust).toBeLessThanOrEqual(result.payouts.length);
      }

      if (result.mode === "REFUND_ALL") {
        expect(result.rake).toBe(0);
        expect(result.totalOut).toBe(result.totalIn);
      }
    }
  });

  it("cancel refunds conserve across 500 random markets", () => {
    const rand = mulberry32(0xbeef);

    for (let i = 0; i < 500; i += 1) {
      const stakes: StakeRow[] = Array.from({ length: 1 + Math.floor(rand() * 20) }, (_, u) => ({
        userId: `user-${u}`,
        yesStake: Math.floor(rand() * 300),
        noStake: Math.floor(rand() * 300),
      }));

      const result = computeCancelRefunds(stakes);
      expect(checkConservation(result)).toBe(true);
      expect(result.totalOut).toBe(result.totalIn);
    }
  });
});
