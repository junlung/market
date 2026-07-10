const MS_PER_DAY = 86_400_000;

/**
 * ISO-8601 week key in UTC, e.g. "2026-W28". UTC deliberately: deterministic
 * regardless of server region. Used as the idempotency key for weekly
 * allowance grants (unique [userId, allowanceWeek] in the ledger).
 */
export function getIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // shift to this ISO week's Thursday
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / MS_PER_DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Start of the next ISO week (Monday 00:00 UTC) — "next allowance" display. */
export function getNextIsoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (8 - dayOfWeek));
  return d;
}
