import { describe, expect, it } from "vitest";
import {
  formatChance,
  formatCompactPoints,
  formatCountdown,
  formatPoints,
  formatRelativeTime,
  formatSignedPoints,
} from "@/lib/format";

describe("formatPoints", () => {
  it("formats integers with thousands separators and no decimals", () => {
    expect(formatPoints(1240)).toBe("1,240");
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(-385)).toBe("-385");
  });
});

describe("formatSignedPoints", () => {
  it("prefixes gains with a plus", () => {
    expect(formatSignedPoints(62)).toBe("+62");
    expect(formatSignedPoints(-50)).toBe("-50");
    expect(formatSignedPoints(0)).toBe("0");
  });
});

describe("formatCompactPoints", () => {
  it("compacts thousands", () => {
    expect(formatCompactPoints(2400)).toBe("2.4K");
    expect(formatCompactPoints(999)).toBe("999");
  });
});

describe("formatChance", () => {
  it("renders whole-number percentages", () => {
    expect(formatChance(0.643)).toBe("64%");
    expect(formatChance(0.5)).toBe("50%");
  });

  it("clamps out-of-range values", () => {
    expect(formatChance(1.2)).toBe("100%");
    expect(formatChance(-0.1)).toBe("0%");
  });

  it("handles non-finite input", () => {
    expect(formatChance(Number.NaN)).toBe("--");
  });
});

describe("formatCountdown", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("shows days and hours", () => {
    expect(formatCountdown(new Date("2026-07-13T16:30:00.000Z"), now)).toBe("3d 4h");
  });

  it("shows hours and minutes under a day", () => {
    expect(formatCountdown(new Date("2026-07-10T14:15:00.000Z"), now)).toBe("2h 15m");
  });

  it("shows minutes under an hour and empty when past", () => {
    expect(formatCountdown(new Date("2026-07-10T12:45:00.000Z"), now)).toBe("45m");
    expect(formatCountdown(new Date("2026-07-10T11:00:00.000Z"), now)).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("formats past and future", () => {
    expect(formatRelativeTime(new Date("2026-07-10T10:00:00.000Z"), now)).toBe("2h ago");
    expect(formatRelativeTime(new Date("2026-07-13T12:00:00.000Z"), now)).toBe("in 3d");
  });

  it("falls back to now for sub-minute deltas", () => {
    expect(formatRelativeTime(new Date("2026-07-10T12:00:30.000Z"), now)).toBe("now");
  });
});
