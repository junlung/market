// route gating lives in src/middleware.ts (matcher + withAuth) — this module
// only handles the login round-trip destination
export const DEFAULT_LOGIN_REDIRECT = "/dashboard";

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
