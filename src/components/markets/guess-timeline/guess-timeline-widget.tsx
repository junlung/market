"use client";

import { useActionState, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarRange, CalendarSearch, List } from "lucide-react";
import { placeGuessAction } from "@/app/actions/markets";
import type { ActionResult } from "@/lib/server/market-service";
import type { EquippedCosmetics } from "@/lib/cosmetics";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { dateKeyToDayIndex, dayIndexToDateKey } from "@/lib/guess-dates";
import { GuessBoardList } from "./guess-board-list";
import { GuessClaimBar } from "./guess-claim-bar";
import type { FlagSpec } from "./guess-flag";
import { GuessTimeline } from "./guess-timeline";
import {
  GAP_EXPAND_MAX,
  RANK_MEDALS,
  assignLanes,
  buildSegments,
  gapKey,
  windowAround,
  type DayWindow,
  type GuessMarketStatus,
  type TimelineGuess,
  type TimelineSegment,
} from "./timeline-model";

const initialState: ActionResult = {};

/**
 * The closest-guess board: a scrollable day timeline with every claim planted
 * as a flag, or the same claims as a list. While the market is open, tapping
 * an open day arms the claim/move form; the server (unique [marketId, value])
 * stays the authority on races.
 */
export function GuessTimelineWidget({
  marketId,
  ante,
  status,
  guesses,
  viewerId,
  viewerName,
  viewerCosmetics,
  todayKey,
  actualKey,
}: {
  marketId: string;
  ante: number;
  status: GuessMarketStatus;
  /** Every claim, sorted by date ascending. */
  guesses: TimelineGuess[];
  viewerId: string;
  viewerName: string;
  /** For the ghost-flag preview when the viewer hasn't claimed yet. */
  viewerCosmetics: EquippedCosmetics | null;
  /** Server-computed so SSR and hydration agree; guesses live in UTC days. */
  todayKey: string;
  actualKey: string | null;
}) {
  const [state, formAction, pending] = useActionState(placeGuessAction, initialState);
  const [mode, setMode] = useState<"timeline" | "list">("timeline");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [inspectedUserId, setInspectedUserId] = useState<string | null>(null);
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<string>>(new Set());
  const [extraBefore, setExtraBefore] = useState(0);
  const [extraAfter, setExtraAfter] = useState(0);
  const [jumpAnchors, setJumpAnchors] = useState<number[]>([]);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [scrollTarget, setScrollTarget] = useState<{ day: number; nonce: number } | null>(null);

  const isOpen = status === "open";
  const todayDay = dateKeyToDayIndex(todayKey);
  const actualDay = actualKey ? dateKeyToDayIndex(actualKey) : null;

  const ownEntry = guesses.find((guess) => guess.userId === viewerId) ?? null;
  const ownKey = ownEntry?.dateKey ?? null;
  const ownDay = ownKey ? dateKeyToDayIndex(ownKey) : null;

  const takenByDay = useMemo(() => {
    const map = new Map<number, TimelineGuess>();
    for (const guess of guesses) {
      map.set(dateKeyToDayIndex(guess.dateKey), guess);
    }
    return map;
  }, [guesses]);

  // a pending selection survives only while it's still claimable: a successful
  // claim/move (ownKey catches up via revalidation) or someone racing to the
  // same day clears it by derivation, not by effect
  const effectiveSelected =
    isOpen &&
    selectedKey !== null &&
    selectedKey !== ownKey &&
    !takenByDay.has(dateKeyToDayIndex(selectedKey))
      ? selectedKey
      : null;
  const selectedDay = effectiveSelected ? dateKeyToDayIndex(effectiveSelected) : null;
  const inspected = inspectedUserId
    ? (guesses.find((guess) => guess.userId === inspectedUserId) ?? null)
    : null;

  const [focusDay, setFocusDay] = useState(ownDay ?? todayDay);

  const segments: TimelineSegment[] = useMemo(() => {
    const windows: DayWindow[] = [
      // claimable runway keeps the near future visible even on an empty board
      { start: todayDay - 3, end: todayDay + 45 },
      ...[...takenByDay.keys()].map(windowAround),
      ...jumpAnchors.map(windowAround),
    ];
    if (selectedDay !== null) windows.push(windowAround(selectedDay));
    if (actualDay !== null) windows.push(windowAround(actualDay));
    if (extraBefore > 0 || extraAfter > 0) {
      const min = Math.min(...windows.map((w) => w.start));
      const max = Math.max(...windows.map((w) => w.end));
      if (extraBefore > 0) windows.push({ start: min - extraBefore * 30, end: min });
      if (extraAfter > 0) windows.push({ start: max, end: max + extraAfter * 30 });
    }
    return buildSegments(windows, expandedGaps);
  }, [todayDay, takenByDay, jumpAnchors, selectedDay, actualDay, extraBefore, extraAfter, expandedGaps]);

  const flags: FlagSpec[] = useMemo(() => {
    const specs: FlagSpec[] = guesses.map((guess) => {
      const podium = status === "resolved" && guess.finalRank !== null && guess.finalRank <= 3;
      return {
        entry: guess,
        day: dateKeyToDayIndex(guess.dateKey),
        lane: 0,
        isOwn: guess.userId === viewerId,
        medal: podium ? RANK_MEDALS[(guess.finalRank ?? 1) - 1] : null,
        dimmed: status === "resolved" && !podium,
      };
    });
    if (effectiveSelected && selectedDay !== null) {
      specs.push({
        entry: {
          userId: viewerId,
          name: viewerName,
          username: "",
          cosmetics: viewerCosmetics,
          dateKey: effectiveSelected,
          finalRank: null,
          payout: null,
        },
        day: selectedDay,
        lane: 0,
        isOwn: false,
        ghost: true,
      });
    }
    specs.sort((a, b) => a.day - b.day);
    const lanes = assignLanes(specs.map((spec) => spec.day));
    return specs.map((spec) => ({ ...spec, lane: lanes.get(spec.day) ?? 0 }));
  }, [guesses, status, viewerId, viewerName, viewerCosmetics, effectiveSelected, selectedDay]);

  // median claim: always on a rendered day, unlike a mean that can land in a gap
  const initialCenterDay =
    ownDay ??
    (guesses.length > 0
      ? dateKeyToDayIndex(guesses[Math.floor((guesses.length - 1) / 2)].dateKey)
      : todayDay);

  function jumpTo(day: number) {
    setScrollTarget((previous) => ({ day, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  function handleDayTap(day: number) {
    const entry = takenByDay.get(day);
    if (entry) {
      setInspectedUserId(entry.userId);
      setSelectedKey(null);
      return;
    }
    if (!isOpen) return;
    setSelectedKey(dayIndexToDateKey(day));
    setInspectedUserId(null);
  }

  function handleFlagTap(flag: FlagSpec) {
    if (flag.ghost) {
      setSelectedKey(null);
      return;
    }
    setInspectedUserId(flag.entry.userId);
    setSelectedKey(null);
  }

  function handleGapTap(gap: Extract<TimelineSegment, { kind: "gap" }>) {
    if (gap.days <= GAP_EXPAND_MAX) {
      setExpandedGaps((previous) => new Set(previous).add(gapKey(gap)));
    } else {
      setJumpOpen(true);
    }
  }

  function handleJump(event: React.FormEvent) {
    event.preventDefault();
    if (!jumpValue) return;
    const day = dateKeyToDayIndex(jumpValue);
    setJumpAnchors((previous) => (previous.includes(day) ? previous : [...previous, day]));
    jumpTo(day);
    const taken = takenByDay.get(day);
    if (taken) {
      setInspectedUserId(taken.userId);
      setSelectedKey(null);
    } else if (isOpen) {
      setSelectedKey(jumpValue);
      setInspectedUserId(null);
    }
    setJumpOpen(false);
  }

  if (status === "canceled") {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">Claimed dates</p>
        <div className="mt-1">
          <GuessBoardList guesses={guesses} ante={ante} isResolved={false} />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-2 p-4 pb-3">
        <p className="mr-auto text-xs font-medium uppercase tracking-wide text-faint">
          {status === "resolved" ? "Final board" : "Claimed dates"}
        </p>
        {mode === "timeline" ? (
          <>
            <HeaderChip onClick={() => jumpTo(todayDay)}>Today</HeaderChip>
            {ownDay !== null ? (
              <HeaderChip onClick={() => jumpTo(ownDay)}>Your flag</HeaderChip>
            ) : null}
            <HeaderChip onClick={() => setJumpOpen((open) => !open)} aria-expanded={jumpOpen}>
              <CalendarSearch className="size-3.5" aria-hidden /> Jump
            </HeaderChip>
          </>
        ) : null}
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Board view">
          <button
            type="button"
            aria-pressed={mode === "timeline"}
            onClick={() => setMode("timeline")}
            className={clsx(
              "rounded-md p-1.5 transition-colors",
              mode === "timeline" ? "bg-surface-2 text-foreground" : "text-faint hover:text-foreground",
            )}
          >
            <CalendarRange className="size-4" aria-hidden />
            <span className="sr-only">Timeline view</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
            className={clsx(
              "rounded-md p-1.5 transition-colors",
              mode === "list" ? "bg-surface-2 text-foreground" : "text-faint hover:text-foreground",
            )}
          >
            <List className="size-4" aria-hidden />
            <span className="sr-only">List view</span>
          </button>
        </div>
      </header>

      {mode === "timeline" ? (
        <>
          {jumpOpen ? (
            <form onSubmit={handleJump} className="flex items-end gap-2 px-4 pb-3">
              <div>
                <Label htmlFor={`guess-jump-${marketId}`}>Jump to date</Label>
                <Input
                  id={`guess-jump-${marketId}`}
                  type="date"
                  value={jumpValue}
                  onChange={(event) => setJumpValue(event.target.value)}
                  autoFocus
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" disabled={!jumpValue}>
                Go
              </Button>
            </form>
          ) : null}
          {guesses.length === 0 && isOpen ? (
            <p className="px-4 pb-1 text-sm text-muted">
              Nobody&apos;s in yet — the timeline is wide open.
            </p>
          ) : null}
          <GuessTimeline
            segments={segments}
            flags={flags}
            takenByDay={takenByDay}
            selectedDay={selectedDay}
            todayDay={todayDay}
            actualDay={actualDay}
            interactive={isOpen}
            focusDay={focusDay}
            onFocusDay={setFocusDay}
            onDayTap={handleDayTap}
            onFlagTap={handleFlagTap}
            onGapTap={handleGapTap}
            onExtend={(direction) =>
              direction < 0 ? setExtraBefore((n) => n + 1) : setExtraAfter((n) => n + 1)
            }
            initialCenterDay={initialCenterDay}
            scrollTarget={scrollTarget}
          />
          <div className="min-h-14 border-t border-border p-3">
            <GuessClaimBar
              marketId={marketId}
              ante={ante}
              status={status}
              ownKey={ownKey}
              selectedKey={effectiveSelected}
              inspected={inspected}
              viewerId={viewerId}
              guesses={guesses}
              formAction={formAction}
              pending={pending}
              state={state}
              onClear={() => {
                setSelectedKey(null);
                setInspectedUserId(null);
              }}
            />
          </div>
        </>
      ) : (
        <div className="px-4 pb-2">
          <GuessBoardList guesses={guesses} ante={ante} isResolved={status === "resolved"} />
        </div>
      )}
    </section>
  );
}

function HeaderChip({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
      {...props}
    >
      {children}
    </button>
  );
}
