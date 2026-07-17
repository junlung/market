import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_KEY,
  evaluateAchievements,
  preBetImpliedProb,
  type ResolvedMarketFact,
} from "@/lib/achievements";

function fact(overrides: Partial<ResolvedMarketFact> & { marketId: string }): ResolvedMarketFact {
  return {
    resolvedAt: new Date("2026-07-01T00:00:00Z"),
    won: false,
    category: "misc",
    minWinningImpliedProb: null,
    ...overrides,
  };
}

/** n facts resolved a day apart, won[i] controlling each outcome. */
function series(wins: boolean[]): ResolvedMarketFact[] {
  return wins.map((won, index) =>
    fact({
      marketId: `m-${String(index).padStart(3, "0")}`,
      resolvedAt: new Date(Date.UTC(2026, 0, 1 + index)),
      won,
    }),
  );
}

describe("evaluateAchievements", () => {
  it("returns nothing for an empty history", () => {
    expect(evaluateAchievements([])).toEqual([]);
  });

  it("grants first-win on any won market and nothing on losses", () => {
    expect(evaluateAchievements(series([false, false]))).toEqual([]);
    expect(evaluateAchievements(series([false, true]))).toContain("first-win");
  });

  it("counts streaks at exactly the boundary", () => {
    expect(evaluateAchievements(series([true, true]))).not.toContain("streak-3");
    expect(evaluateAchievements(series([true, true, true]))).toContain("streak-3");
    expect(evaluateAchievements(series([true, true, true]))).not.toContain("streak-5");
  });

  it("breaks streaks on a loss", () => {
    // 2 wins, loss, 2 wins — never 3 consecutive
    expect(evaluateAchievements(series([true, true, false, true, true]))).not.toContain("streak-3");
    // 3 consecutive buried mid-history still counts
    expect(evaluateAchievements(series([false, true, true, true, false]))).toContain("streak-3");
  });

  it("orders by resolution time, not input order", () => {
    // input order: win, win, loss, win — but resolution order interleaves the
    // loss between the wins, so no 3-streak
    const shuffled = [
      fact({ marketId: "a", resolvedAt: new Date("2026-01-01"), won: true }),
      fact({ marketId: "b", resolvedAt: new Date("2026-01-03"), won: true }),
      fact({ marketId: "c", resolvedAt: new Date("2026-01-02"), won: false }),
      fact({ marketId: "d", resolvedAt: new Date("2026-01-04"), won: true }),
    ];
    expect(evaluateAchievements(shuffled)).not.toContain("streak-3");

    // same rows with the loss moved first → wins become consecutive
    const reordered = shuffled.map((row) =>
      row.marketId === "c" ? { ...row, resolvedAt: new Date("2025-12-31") } : row,
    );
    expect(evaluateAchievements(reordered)).toContain("streak-3");
  });

  it("grants longshot-win strictly under the 10% threshold", () => {
    const at10 = [fact({ marketId: "m", won: true, minWinningImpliedProb: 0.1 })];
    const under10 = [fact({ marketId: "m", won: true, minWinningImpliedProb: 0.099 })];
    const lostLongshot = [fact({ marketId: "m", won: false, minWinningImpliedProb: 0.01 })];

    expect(evaluateAchievements(at10)).not.toContain("longshot-win");
    expect(evaluateAchievements(under10)).toContain("longshot-win");
    expect(evaluateAchievements(lostLongshot)).not.toContain("longshot-win");
  });

  it("counts volume across wins and losses at the boundary", () => {
    expect(evaluateAchievements(series(Array(9).fill(false)))).not.toContain("volume-10");
    const ten = evaluateAchievements(series(Array(10).fill(false)));
    expect(ten).toContain("volume-10");
    expect(ten).not.toContain("volume-50");
  });

  it("stacks every earned key in one pass", () => {
    const history = [
      ...series(Array(10).fill(true)),
      fact({
        marketId: "longshot",
        resolvedAt: new Date("2026-06-01"),
        won: true,
        minWinningImpliedProb: 0.05,
      }),
    ];
    const earned = evaluateAchievements(history);
    expect(earned).toEqual(
      expect.arrayContaining([
        "first-win",
        "streak-3",
        "streak-5",
        "streak-10",
        "longshot-win",
        "volume-10",
      ]),
    );
  });
});

describe("category win tiers", () => {
  function categorySeries(category: string, wins: number, losses = 0): ResolvedMarketFact[] {
    return Array.from({ length: wins + losses }, (_, index) =>
      fact({
        marketId: `${category}-${String(index).padStart(3, "0")}`,
        resolvedAt: new Date(Date.UTC(2026, 0, 1 + index)),
        won: index < wins,
        category,
      }),
    );
  }

  it("counts wins per eligible category at the tier boundary", () => {
    expect(evaluateAchievements(categorySeries("sports", 2))).not.toContain("cat-sports-3");
    const three = evaluateAchievements(categorySeries("sports", 3));
    expect(three).toContain("cat-sports-3");
    expect(three).not.toContain("cat-sports-10");
    expect(evaluateAchievements(categorySeries("sports", 10))).toContain("cat-sports-10");
  });

  it("losses and other categories don't advance a category's count", () => {
    // 3 sports losses + 3 news wins → no sports tier, news tier earned
    const mixed = [
      ...categorySeries("sports", 0, 3),
      ...categorySeries("news", 3),
    ];
    const earned = evaluateAchievements(mixed);
    expect(earned).not.toContain("cat-sports-3");
    expect(earned).toContain("cat-news-3");
  });

  it("misc and non-canonical categories earn nothing", () => {
    const earned = evaluateAchievements([
      ...categorySeries("misc", 10),
      ...categorySeries("Sports", 10), // pre-remap free text ≠ the slug
    ]);
    expect(earned.some((key) => key.startsWith("cat-"))).toBe(false);
  });
});

describe("preBetImpliedProb", () => {
  it("recovers the pre-bet probability from post-bet snapshots", () => {
    // before: outcome 100 / total 400 = 25%; bet 100 → after: 200/500
    expect(preBetImpliedProb({ amount: 100, outcomePoolAfter: 200, totalPoolAfter: 500 })).toBe(0.25);
  });

  it("returns null for the first bet into an empty market", () => {
    expect(preBetImpliedProb({ amount: 50, outcomePoolAfter: 50, totalPoolAfter: 50 })).toBeNull();
  });

  it("returns 0 for the first bet on an untouched outcome in a live market", () => {
    expect(preBetImpliedProb({ amount: 50, outcomePoolAfter: 50, totalPoolAfter: 350 })).toBe(0);
  });
});

describe("achievement definitions", () => {
  it("keeps keys unique and gem amounts positive", () => {
    expect(ACHIEVEMENTS_BY_KEY.size).toBe(ACHIEVEMENTS.length);
    for (const def of ACHIEVEMENTS) {
      expect(def.gems).toBeGreaterThan(0);
      if (def.badgeSlug) {
        expect(def.badgeName).toBeTruthy();
        expect(def.badgeStyle).toBeTruthy();
      }
    }
  });
});
