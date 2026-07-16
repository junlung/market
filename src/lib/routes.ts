export const DEFAULT_LOGIN_REDIRECT = "/dashboard";
export const AUTH_ROUTES = ["/sign-in", "/sign-up"];
export const PUBLIC_ROUTES = ["/"];
export const ADMIN_PREFIX = "/admin";
export const PROTECTED_PREFIXES = ["/dashboard", "/portfolio", "/history", "/leaderboard", "/account", "/markets", "/leagues", "/l", "/store", "/join"];

/**
 * Only same-origin destinations survive the login round-trip — anything else
 * is an open redirect. Accepts relative paths and absolute URLs matching
 * `currentOrigin` (the auth middleware appends callbackUrl as an absolute URL).
 */
export function safeCallbackUrl(raw: string | undefined | null, currentOrigin?: string) {
  if (!raw) {
    return DEFAULT_LOGIN_REDIRECT;
  }
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  if (currentOrigin) {
    try {
      const url = new URL(raw);
      if (url.origin === currentOrigin) {
        return url.pathname + url.search;
      }
    } catch {
      // fall through to the default
    }
  }
  return DEFAULT_LOGIN_REDIRECT;
}
