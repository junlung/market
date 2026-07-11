"use client";

import { useEffect, useState } from "react";

const FORMATS = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/**
 * Absolute timestamps rendered in the viewer's own timezone. Server
 * components format dates in the server's zone (UTC on Vercel), which made
 * "closes at 5 PM" disagree with the countdown by the UTC offset. This
 * renders a deterministic UTC string on the server and first client paint,
 * then swaps to the local zone after mount — same pattern as CountdownBadge.
 */
export function LocalTime({
  date,
  mode = "datetime",
}: {
  date: Date | string;
  mode?: keyof typeof FORMATS;
}) {
  const value = typeof date === "string" ? new Date(date) : date;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const text = new Intl.DateTimeFormat("en-US", {
    ...FORMATS[mode],
    ...(mounted ? {} : { timeZone: "UTC" }),
  }).format(value);

  return (
    <time dateTime={value.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
