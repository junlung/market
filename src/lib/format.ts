export function formatPoints(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatSignedPoints(value: number) {
  return `${value > 0 ? "+" : ""}${formatPoints(value)}`;
}

export function formatCompactPoints(value: number) {
  if (Math.abs(value) < 1000) {
    return formatPoints(value);
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatPercent0(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function formatChance(probability: number) {
  if (!Number.isFinite(probability)) {
    return "--";
  }

  return formatPercent0(Math.min(Math.max(probability, 0), 1));
}

export function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(typeof value === "string" ? new Date(value) : value);
}

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 31_536_000_000 },
  { unit: "month", ms: 2_592_000_000 },
  { unit: "day", ms: 86_400_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
];

export function formatRelativeTime(value: Date | string, now: Date = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  const diff = date.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always", style: "narrow" });

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) {
      return formatter.format(Math.trunc(diff / ms), unit);
    }
  }

  return "now";
}

/** Compact countdown like "3d 4h", "2h 15m", "45m" — empty string when past. */
export function formatCountdown(closeTime: Date | string, now: Date = new Date()) {
  const target = typeof closeTime === "string" ? new Date(closeTime) : closeTime;
  const diff = target.getTime() - now.getTime();

  if (diff <= 0) {
    return "";
  }

  const minutes = Math.floor(diff / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  return `${Math.max(mins, 1)}m`;
}
