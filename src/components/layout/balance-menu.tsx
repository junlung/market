"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Coins, Crown, Gem, Moon } from "lucide-react";
import { formatPoints } from "@/lib/format";

export type LeagueStack = {
  slug: string;
  name: string;
  balance: number;
  seasonName: string | null;
  dormant: boolean;
};

/**
 * The top-nav balance chip: a dropdown of every stack you hold — Global
 * first, then one row per league (dormant = no season running, so no stack
 * to spend) — plus your gems (the persistent cosmetic currency, styled
 * distinctly so it never reads as spendable points). The chip face stays
 * points-only; points are the daily currency.
 */
export function BalanceMenu({
  globalBalance,
  allowanceLanded,
  leagues,
  gems,
}: {
  globalBalance: number;
  allowanceLanded: boolean;
  leagues: LeagueStack[];
  gems: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const chipClass =
    "flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors hover:bg-border";

  const allowanceDot = allowanceLanded ? (
    <span className="size-1.5 rounded-full bg-yes" aria-label="Weekly allowance received" />
  ) : null;

  const rowClass =
    "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-surface-2";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={allowanceLanded ? "This week's allowance is in" : "Your balances"}
        className={chipClass}
      >
        <Coins className="size-4 text-warn" aria-hidden />
        {formatPoints(globalBalance)}
        {allowanceDot}
        <ChevronDown className="size-3.5 text-faint" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <p className="px-3 py-2 text-xs font-medium text-faint">Your balances</p>
          <Link href="/account" className={rowClass} onClick={() => setOpen(false)}>
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <Coins className="size-4 shrink-0 text-warn" aria-hidden />
              <span className="truncate">Global League</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">
              {formatPoints(globalBalance)} pts
            </span>
          </Link>
          {leagues.map((league) => (
            <Link
              key={league.slug}
              href={`/l/${league.slug}` as Route}
              className={rowClass}
              onClick={() => setOpen(false)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 font-medium">
                  <Crown className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{league.name}</span>
                </span>
                <span className="pl-6 text-[11px] text-faint">
                  {league.dormant ? "no season running" : (league.seasonName ?? "current stack")}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {league.dormant ? (
                  <Moon className="size-3.5 text-faint" aria-label="Dormant" />
                ) : (
                  `${formatPoints(league.balance)} pts`
                )}
              </span>
            </Link>
          ))}
          <div className="mt-1.5 border-t border-border pt-1.5">
            <Link href="/store" className={rowClass} onClick={() => setOpen(false)}>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 font-medium">
                  <Gem className="size-4 shrink-0 text-gem" aria-hidden />
                  <span className="truncate">Gems</span>
                </span>
                <span className="pl-6 text-[11px] text-faint">spend in the store</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-gem">
                {formatPoints(gems)}
              </span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
