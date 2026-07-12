/** Runtime lookup key for the one global league (see League.isGlobal). */
export const GLOBAL_LEAGUE_SLUG = "global";

/**
 * UTC calendar-month window containing `date` — the Global League's season
 * bounds. UTC deliberately, like the allowance week key: deterministic
 * regardless of server region. endsAt is exclusive (the next month's start).
 */
export function getMonthWindow(date: Date): { startsAt: Date; endsAt: Date } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    startsAt: new Date(Date.UTC(year, month, 1)),
    endsAt: new Date(Date.UTC(year, month + 1, 1)),
  };
}

const MONTH_NAME = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Display name for a monthly season, e.g. "July 2026". */
export function getMonthSeasonName(date: Date): string {
  return MONTH_NAME.format(date);
}

/**
 * Competition ranking (1, 1, 3, ...): rows are sorted by score descending
 * (ties broken by name for a stable order) and equal scores share a rank.
 * Same convention the all-time leaderboard page uses.
 */
export function rankByScore<T extends { score: number; name: string }>(
  rows: T[],
): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  let lastScore = Number.NaN;
  let lastRank = 0;
  return sorted.map((row, index) => {
    const rank = row.score === lastScore ? lastRank : index + 1;
    lastScore = row.score;
    lastRank = rank;
    return { ...row, rank };
  });
}
