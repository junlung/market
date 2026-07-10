import { describe, expect, it } from "vitest";
import { getIsoWeekKey, getNextIsoWeekStart } from "@/lib/allowance";

describe("getIsoWeekKey", () => {
  it("matches known ISO week fixtures", () => {
    // 2026-01-01 is a Thursday -> week 1 of 2026
    expect(getIsoWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
    // 2021-01-01 is a Friday -> belongs to 2020's week 53
    expect(getIsoWeekKey(new Date(Date.UTC(2021, 0, 1)))).toBe("2020-W53");
    // 2024-12-30 is a Monday -> already week 1 of 2025
    expect(getIsoWeekKey(new Date(Date.UTC(2024, 11, 30)))).toBe("2025-W01");
    // 2026-07-10 (today-ish fixture), a Friday in week 28
    expect(getIsoWeekKey(new Date(Date.UTC(2026, 6, 10)))).toBe("2026-W28");
  });

  it("splits Sunday and Monday across week boundaries", () => {
    // Sunday 2026-07-12 is the end of W28; Monday 2026-07-13 starts W29
    expect(getIsoWeekKey(new Date(Date.UTC(2026, 6, 12, 23, 59)))).toBe("2026-W28");
    expect(getIsoWeekKey(new Date(Date.UTC(2026, 6, 13, 0, 0)))).toBe("2026-W29");
  });

  it("uses UTC, not local time", () => {
    // 2026-07-12 23:30 UTC is still Sunday W28 regardless of server TZ
    const lateSunday = new Date("2026-07-12T23:30:00.000Z");
    expect(getIsoWeekKey(lateSunday)).toBe("2026-W28");
  });

  it("zero-pads single-digit weeks", () => {
    expect(getIsoWeekKey(new Date(Date.UTC(2026, 1, 3)))).toBe("2026-W06");
  });
});

describe("getNextIsoWeekStart", () => {
  it("returns the next Monday 00:00 UTC", () => {
    // Friday 2026-07-10 -> Monday 2026-07-13
    expect(getNextIsoWeekStart(new Date(Date.UTC(2026, 6, 10))).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z",
    );
    // Monday itself advances a full week
    expect(getNextIsoWeekStart(new Date(Date.UTC(2026, 6, 13))).toISOString()).toBe(
      "2026-07-20T00:00:00.000Z",
    );
    // Sunday advances one day
    expect(getNextIsoWeekStart(new Date(Date.UTC(2026, 6, 12))).toISOString()).toBe(
      "2026-07-13T00:00:00.000Z",
    );
  });
});
