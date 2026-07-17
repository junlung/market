import { describe, expect, it } from "vitest";
import { CLOSEST_GUESS_SPLITS, computeGuessSettlement } from "@/lib/closest-guess";

const DAY = 24 * 60 * 60 * 1000;
const actual = Date.UTC(2026, 7, 15);

function guess(userId: string, daysOff: number) {
  return { userId, valueMs: actual + daysOff * DAY };
}

describe("computeGuessSettlement", () => {
  it("splits the pot 60/25/15 across the podium and burns nothing extra", () => {
    // 5 entrants × 100 ante = 500 pot
    const result = computeGuessSettlement(
      [guess("a", 1), guess("b", -2), guess("c", 3), guess("d", 10), guess("e", -20)],
      actual,
      100,
    );

    expect(result.totalIn).toBe(500);
    expect(result.payouts).toEqual([
      { userId: "a", rank: 1, amount: 300 },
      { userId: "b", rank: 2, amount: 125 },
      { userId: "c", rank: 3, amount: 75 },
    ]);
    expect(result.dust).toBe(0);
    expect(result.ranks.find((row) => row.userId === "e")?.rank).toBe(5);
  });

  it("ties on distance share a rank and split the consumed positions' shares", () => {
    // a and b are both exactly 1 day off (opposite sides) — they split 60+25
    const result = computeGuessSettlement(
      [guess("a", 1), guess("b", -1), guess("c", 5), guess("d", 9)],
      actual,
      100,
    );

    const a = result.payouts.find((row) => row.userId === "a")!;
    const b = result.payouts.find((row) => row.userId === "b")!;
    const c = result.payouts.find((row) => row.userId === "c")!;
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(1);
    expect(a.amount).toBe(b.amount);
    expect(a.amount).toBe(Math.floor((240 + 100) / 2)); // (60% + 25%) of 400, halved
    expect(c.rank).toBe(3);
    expect(c.amount).toBe(60); // 15% of 400
    expect(result.totalIn).toBe(result.totalOut + result.dust);
  });

  it("rolls unclaimed podium shares to 1st when there are fewer than 3 entrants", () => {
    const two = computeGuessSettlement([guess("a", 1), guess("b", 2)], actual, 100);
    expect(two.payouts).toEqual([
      { userId: "a", rank: 1, amount: 150 }, // 60% + unclaimed 15% of 200
      { userId: "b", rank: 2, amount: 50 },
    ]);
    expect(two.dust).toBe(0);

    const solo = computeGuessSettlement([guess("a", 40)], actual, 100);
    expect(solo.payouts).toEqual([{ userId: "a", rank: 1, amount: 100 }]);
  });

  it("burns flooring remainders as dust, conserving the pot", () => {
    // 3 entrants × 33 = 99 pot; splits produce floors
    const result = computeGuessSettlement(
      [guess("a", 1), guess("b", 2), guess("c", 3)],
      actual,
      33,
    );
    expect(result.totalIn).toBe(99);
    expect(result.totalIn).toBe(result.totalOut + result.dust);
    // 1st absorbs the percent-rounding remainder
    const first = result.payouts.find((row) => row.rank === 1)!;
    expect(first.amount).toBeGreaterThanOrEqual(Math.floor((99 * CLOSEST_GUESS_SPLITS[0]) / 100));
  });

  it("handles a full tie across everyone", () => {
    // distances tie at 2 days for everyone (b from the other side)
    const result = computeGuessSettlement(
      [guess("a", 2), guess("b", -2), guess("c", 2)],
      actual,
      100,
    );
    expect(result.payouts.filter((row) => row.rank === 1)).toHaveLength(3);
    expect(result.totalIn).toBe(result.totalOut + result.dust);
    expect(result.payouts[0].amount).toBe(100); // 300 pot / 3
  });

  it("no entrants settles empty; duplicate users are rejected", () => {
    expect(computeGuessSettlement([], actual, 100)).toEqual({
      payouts: [],
      ranks: [],
      totalIn: 0,
      totalOut: 0,
      dust: 0,
    });
    expect(() =>
      computeGuessSettlement([guess("a", 1), guess("a", 2)], actual, 100),
    ).toThrow(/one guess/i);
  });

  it("conserves across randomized pots", () => {
    for (let trial = 0; trial < 500; trial += 1) {
      const entrants = 1 + Math.floor(Math.random() * 12);
      const ante = 1 + Math.floor(Math.random() * 500);
      const guesses = Array.from({ length: entrants }, (_, index) => ({
        userId: `u${index}`,
        valueMs: actual + Math.floor(Math.random() * 60 - 30) * DAY,
      }));
      const result = computeGuessSettlement(guesses, actual, ante);
      expect(result.totalIn).toBe(entrants * ante);
      expect(result.totalIn).toBe(result.totalOut + result.dust);
      for (const payout of result.payouts) {
        expect(payout.amount).toBeGreaterThan(0);
      }
    }
  });
});
