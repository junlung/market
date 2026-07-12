// Username handles: stable lowercase slugs for profile URLs (/u/[username]).
// Display names stay mutable and non-unique; the handle is what links.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

// no leading/trailing hyphen; lowercase letters, digits, hyphens between
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Handles that would be confusing or collide with app vocabulary. Route
// prefixes aren't a routing hazard (profiles live under /u/), but an
// "admin" handle reads as authority it doesn't have.
export const RESERVED_USERNAMES = new Set([
  "admin",
  "admins",
  "administrator",
  "mod",
  "moderator",
  "system",
  "support",
  "prollymarket",
  "api",
  "account",
  "activity",
  "dashboard",
  "history",
  "invite",
  "leaderboard",
  "market",
  "markets",
  "me",
  "portfolio",
  "settings",
  "sign-in",
  "sign-up",
  "null",
  "undefined",
]);

/**
 * The suggestion shown at signup — mirrors the SQL backfill in
 * prisma/migrations/20260712000000_social_profiles_items: lowercase,
 * non-alphanumeric runs collapse to "-", trimmed, clamped to USERNAME_MAX,
 * "player" when nothing usable survives. Uniqueness is the caller's problem.
 */
export function suggestUsername(displayName: string) {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX)
    .replace(/^-+|-+$/g, "");

  return slug.length >= USERNAME_MIN ? slug : "player";
}
