/** Runtime lookup key for the one global league (see League.isGlobal). */
export const GLOBAL_LEAGUE_SLUG = "global";

export const LEAGUE_SLUG_MIN = 3;
export const LEAGUE_SLUG_MAX = 30;

// slugs that would shadow the global league or read like route machinery
export const RESERVED_LEAGUE_SLUGS = new Set([
  GLOBAL_LEAGUE_SLUG,
  "new",
  "join",
  "create",
  "settings",
  "api",
  "admin",
]);

/**
 * League URL slug from a display name — same shape rules as usernames
 * (lowercase, non-alphanumeric runs collapse to "-", trimmed) with a longer
 * cap. Reserved and colliding slugs are the caller's problem ("league" is the
 * fallback when nothing usable survives, never a reserved word).
 */
export function suggestLeagueSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LEAGUE_SLUG_MAX)
    .replace(/^-+|-+$/g, "");

  if (slug.length < LEAGUE_SLUG_MIN || RESERVED_LEAGUE_SLUGS.has(slug)) {
    return "league";
  }
  return slug;
}

// unambiguous alphabet: no 0/O, 1/I — codes get read out loud in group chats
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Uppercases and strips separators so "abcd-1234" matches "ABCD1234". */
export function normalizeInviteCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "XXXX-XXXX" display form of a stored 8-char code. */
export function formatInviteCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

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
