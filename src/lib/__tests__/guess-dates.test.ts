import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  dateKeyToDayIndex,
  dateKeyToUtcIso,
  dateToDateKey,
  dayIndexToDateKey,
  formatDateKey,
  monthLabelForDayIndex,
} from "@/lib/guess-dates";

describe("dateToDateKey", () => {
  it("extracts the UTC calendar date from a UTC-midnight instant", () => {
    expect(dateToDateKey(new Date("2026-09-12T00:00:00.000Z"))).toBe("2026-09-12");
  });

  it("uses the UTC day even when local zones would disagree", () => {
    // 23:30 UTC is already "tomorrow" in UTC+1 — the key must stay on the UTC day
    expect(dateToDateKey(new Date("2026-12-31T23:30:00.000Z"))).toBe("2026-12-31");
  });
});

describe("day index round-trips", () => {
  it("round-trips keys through day indexes", () => {
    for (const key of ["1970-01-01", "1969-12-31", "2000-02-29", "2026-09-12", "2100-01-01"]) {
      expect(dayIndexToDateKey(dateKeyToDayIndex(key))).toBe(key);
    }
  });

  it("anchors the epoch at zero", () => {
    expect(dateKeyToDayIndex("1970-01-01")).toBe(0);
    expect(dateKeyToDayIndex("1970-01-02")).toBe(1);
  });

  it("counts exact whole days across month and year boundaries", () => {
    expect(dateKeyToDayIndex("2027-01-01") - dateKeyToDayIndex("2026-12-31")).toBe(1);
    expect(dateKeyToDayIndex("2026-03-01") - dateKeyToDayIndex("2026-02-28")).toBe(1);
    // 2028 is a leap year
    expect(dateKeyToDayIndex("2028-03-01") - dateKeyToDayIndex("2028-02-28")).toBe(2);
    expect(dateKeyToDayIndex("2027-09-12") - dateKeyToDayIndex("2026-09-12")).toBe(365);
  });

  it("matches raw UTC millisecond math", () => {
    expect(dateKeyToDayIndex("2026-09-12")).toBe(Date.parse("2026-09-12T00:00:00.000Z") / DAY_MS);
  });
});

describe("dateKeyToUtcIso", () => {
  it("pins the key to UTC midnight", () => {
    expect(dateKeyToUtcIso("2026-09-12")).toBe("2026-09-12T00:00:00.000Z");
    expect(new Date(dateKeyToUtcIso("2026-09-12")).toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });
});

describe("formatDateKey", () => {
  it("formats the UTC calendar date", () => {
    expect(formatDateKey("2026-09-12")).toBe("Sep 12, 2026");
    expect(formatDateKey("2026-09-12", "short")).toBe("Sep 12");
    // Jan 1 must not slide to Dec 31 in western zones
    expect(formatDateKey("2027-01-01")).toBe("Jan 1, 2027");
  });
});

describe("monthLabelForDayIndex", () => {
  it("labels the UTC month of a day index", () => {
    expect(monthLabelForDayIndex(dateKeyToDayIndex("2026-09-01"))).toBe("Sep 2026");
    expect(monthLabelForDayIndex(dateKeyToDayIndex("2026-12-31"))).toBe("Dec 2026");
  });
});
