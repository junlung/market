/**
 * Calendar-date helpers for closest-guess markets. A guess is a calendar date
 * pinned to UTC midnight; the yyyy-mm-dd string ("dateKey") is its identity —
 * every browser agrees on which day it names. All math here goes through
 * Date.UTC / getUTC* so no local timezone ever leaks in, and day indexes are
 * exact integers because UTC has no DST.
 */

export const DAY_MS = 86_400_000;

/** UTC-midnight Date → its dateKey ("2026-09-12"). */
export function dateToDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** dateKey → whole days since the Unix epoch (UTC). */
export function dateKeyToDayIndex(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Whole days since the Unix epoch (UTC) → dateKey. */
export function dayIndexToDateKey(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

/** dateKey → the ISO instant the server expects (`...T00:00:00.000Z`). */
export function dateKeyToUtcIso(key: string): string {
  return `${key}T00:00:00.000Z`;
}

const SHORT_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

const LONG_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Sep 12" (short) or "Sep 12, 2026" (long) — always the UTC calendar date. */
export function formatDateKey(key: string, style: "short" | "long" = "long"): string {
  const date = new Date(dateKeyToUtcIso(key));
  return (style === "short" ? SHORT_FORMAT : LONG_FORMAT).format(date);
}

/** Today's dateKey in UTC. */
export function todayUtcKey(): string {
  return dateToDateKey(new Date());
}

/** "Sep 2026" month label for a day index — used for timeline month spans. */
export function monthLabelForDayIndex(index: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  }).format(new Date(index * DAY_MS));
}
