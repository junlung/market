import { describe, expect, it } from "vitest";
import {
  formatInviteCode,
  getMonthSeasonName,
  getMonthWindow,
  normalizeInviteCode,
  rankByScore,
  suggestLeagueSlug,
} from "@/lib/leagues";

describe("getMonthWindow", () => {
  it("returns the UTC calendar month containing the date", () => {
    const { startsAt, endsAt } = getMonthWindow(new Date("2026-07-12T15:30:00Z"));
    expect(startsAt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rolls December into January of the next year", () => {
    const { startsAt, endsAt } = getMonthWindow(new Date("2026-12-31T23:59:59Z"));
    expect(startsAt.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("treats endsAt as exclusive: the first instant of a month belongs to it", () => {
    const boundary = new Date("2026-08-01T00:00:00Z");
    const { startsAt, endsAt } = getMonthWindow(boundary);
    expect(startsAt.getTime()).toBe(boundary.getTime());
    expect(endsAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("handles leap February", () => {
    const { startsAt, endsAt } = getMonthWindow(new Date("2028-02-29T12:00:00Z"));
    expect(startsAt.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  it("is UTC-based: a date late in the UTC month stays in that month", () => {
    // 2026-06-30 23:00 UTC is already July in UTC+2 — the window must not care
    const { startsAt } = getMonthWindow(new Date("2026-06-30T23:00:00Z"));
    expect(startsAt.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("getMonthSeasonName", () => {
  it("names the season after the UTC month and year", () => {
    expect(getMonthSeasonName(new Date("2026-07-12T00:00:00Z"))).toBe("July 2026");
    expect(getMonthSeasonName(new Date("2026-12-31T23:59:59Z"))).toBe("December 2026");
  });
});

describe("rankByScore", () => {
  it("sorts by score descending with name tiebreak and assigns competition ranks", () => {
    const ranked = rankByScore([
      { name: "Casey", score: 50 },
      { name: "Alex", score: 120 },
      { name: "Blair", score: 50 },
    ]);

    expect(ranked.map((row) => [row.name, row.rank])).toEqual([
      ["Alex", 1],
      ["Blair", 2],
      ["Casey", 2],
    ]);
  });

  it("skips ranks after a tie (1, 1, 3)", () => {
    const ranked = rankByScore([
      { name: "A", score: 10 },
      { name: "B", score: 10 },
      { name: "C", score: 5 },
    ]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 3]);
  });

  it("does not mutate its input", () => {
    const rows = [
      { name: "B", score: 1 },
      { name: "A", score: 2 },
    ];
    rankByScore(rows);
    expect(rows[0].name).toBe("B");
  });
});

describe("suggestLeagueSlug", () => {
  it("slugifies names like usernames but with a 30-char cap", () => {
    expect(suggestLeagueSlug("Tahoe Trip 2026!")).toBe("tahoe-trip-2026");
    expect(suggestLeagueSlug("The Boys™ — Fantasy Degens Anonymous Club")).toBe(
      "the-boys-fantasy-degens-anonym",
    );
  });

  it("falls back to 'league' for unusable or reserved names", () => {
    expect(suggestLeagueSlug("!!")).toBe("league");
    expect(suggestLeagueSlug("Global")).toBe("league");
    expect(suggestLeagueSlug("new")).toBe("league");
  });
});

describe("invite codes", () => {
  it("normalizes case and separators", () => {
    expect(normalizeInviteCode("abcd-1234")).toBe("ABCD1234");
    expect(normalizeInviteCode("  ab cd 12:34 ")).toBe("ABCD1234");
  });

  it("formats stored codes for display", () => {
    expect(formatInviteCode("ABCD1234")).toBe("ABCD-1234");
    expect(formatInviteCode("SHORT")).toBe("SHORT");
  });
});
