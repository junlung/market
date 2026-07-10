"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import clsx from "clsx";
import { formatCountdown } from "@/lib/format";

/**
 * Renders a static countdown server-side, then ticks client-side after mount
 * (once per minute) — avoids hydration mismatch from clock drift.
 */
export function CountdownBadge({ closeTime, className }: { closeTime: string | Date; className?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const target = typeof closeTime === "string" ? new Date(closeTime) : closeTime;
  const label = formatCountdown(target, now ?? undefined);
  const msLeft = target.getTime() - (now ?? new Date(0)).getTime();
  const urgent = now !== null && msLeft > 0 && msLeft < 24 * 60 * 60 * 1000;

  if (!label) {
    return (
      <span className={clsx("inline-flex items-center gap-1 text-xs font-medium text-faint", className)}>
        <Clock className="size-3" aria-hidden />
        Closed
      </span>
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        urgent ? "text-warn" : "text-muted",
        className,
      )}
    >
      <Clock className="size-3" aria-hidden />
      {label}
    </span>
  );
}
