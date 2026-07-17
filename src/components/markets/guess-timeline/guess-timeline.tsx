"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayIndexToDateKey, formatDateKey } from "@/lib/guess-dates";
import { GuessFlag, type FlagSpec } from "./guess-flag";
import {
  DAY_W,
  GAP_EXPAND_MAX,
  buildGeometry,
  dayOfMonth,
  dayOfWeek,
  gapLabel,
  monthSpans,
  renderedDays,
  type TimelineGuess,
  type TimelineSegment,
} from "./timeline-model";

/**
 * The scrollable day-ruler. Everything time-positioned (flags, markers, day
 * buttons) hangs off one px-per-day geometry; long empty stretches render as
 * tappable gap chips instead of dead scroll. Interaction results surface in
 * the strip below the track, never in floating popovers — the scroller's
 * overflow would clip them.
 */
export function GuessTimeline({
  segments,
  flags,
  takenByDay,
  selectedDay,
  todayDay,
  actualDay,
  interactive,
  focusDay,
  onFocusDay,
  onDayTap,
  onFlagTap,
  onGapTap,
  onExtend,
  initialCenterDay,
  scrollTarget,
}: {
  segments: TimelineSegment[];
  flags: FlagSpec[];
  takenByDay: Map<number, TimelineGuess>;
  selectedDay: number | null;
  todayDay: number;
  actualDay: number | null;
  interactive: boolean;
  focusDay: number;
  onFocusDay: (day: number) => void;
  onDayTap: (day: number) => void;
  onFlagTap: (flag: FlagSpec) => void;
  onGapTap: (gap: Extract<TimelineSegment, { kind: "gap" }>) => void;
  onExtend: (direction: -1 | 1) => void;
  initialCenterDay: number;
  scrollTarget: { day: number; nonce: number } | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const leftFadeRef = useRef<HTMLDivElement>(null);
  const rightFadeRef = useRef<HTMLDivElement>(null);
  const didInitRef = useRef(false);
  // the day pinned under the viewport center, so segment growth (extending
  // the range, expanding a gap) doesn't yank the view somewhere else
  const anchorRef = useRef<{ day: number; viewportX: number } | null>(null);

  const geometry = useMemo(() => buildGeometry(segments), [segments]);
  const days = useMemo(() => renderedDays(segments), [segments]);

  // the scrolled content leads with the w-12 extend button, so scroller px =
  // EXTEND_W + geometry px; flags/markers live inside a wrapper that excludes it
  const EXTEND_W = 48;

  function centerOnDay(day: number, smooth: boolean) {
    const scroller = scrollRef.current;
    const x = geometry.centerOf(day);
    if (!scroller || x === null) return;
    scroller.scrollTo({
      left: x + EXTEND_W - scroller.clientWidth / 2,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function updateOverflowHints() {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const atStart = scroller.scrollLeft <= 4;
    const atEnd = scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 4;
    if (leftFadeRef.current) leftFadeRef.current.style.opacity = atStart ? "0" : "1";
    if (rightFadeRef.current) rightFadeRef.current.style.opacity = atEnd ? "0" : "1";
  }

  function recordAnchor() {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const day = geometry.dayAt(scroller.scrollLeft + scroller.clientWidth / 2 - EXTEND_W);
    if (day !== null) {
      anchorRef.current = { day, viewportX: scroller.clientWidth / 2 };
    }
  }

  useLayoutEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true;
      centerOnDay(initialCenterDay, false);
    } else if (anchorRef.current) {
      // keep the previously-centered day put when the track's shape changes
      const scroller = scrollRef.current;
      const x = geometry.centerOf(anchorRef.current.day);
      if (scroller && x !== null) {
        scroller.scrollLeft = x + EXTEND_W - anchorRef.current.viewportX;
      }
    }
    updateOverflowHints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  useEffect(() => {
    if (scrollTarget && didInitRef.current) {
      centerOnDay(scrollTarget.day, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget?.nonce]);

  function focusDayButton(day: number) {
    onFocusDay(day);
    trackRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)
      ?.focus();
  }

  function nearestRendered(target: number): number | undefined {
    if (days.length === 0) return undefined;
    let best = days[0];
    for (const day of days) {
      if (Math.abs(day - target) < Math.abs(best - target)) best = day;
    }
    return best;
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    const index = days.indexOf(focusDay);
    if (index === -1) return;
    let target: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        target = days[index + 1];
        break;
      case "ArrowLeft":
        target = days[index - 1];
        break;
      case "PageDown":
        target = nearestRendered(focusDay + 30);
        break;
      case "PageUp":
        target = nearestRendered(focusDay - 30);
        break;
      case "Home":
      case "End": {
        const segment = segments.find(
          (s): s is Extract<TimelineSegment, { kind: "days" }> =>
            s.kind === "days" && focusDay >= s.start && focusDay < s.start + s.count,
        );
        if (segment) {
          target = event.key === "Home" ? segment.start : segment.start + segment.count - 1;
        }
        break;
      }
      default:
        return;
    }
    if (target !== undefined && target !== focusDay) {
      event.preventDefault();
      focusDayButton(target);
    }
  }

  function scrollByViewport(direction: -1 | 1) {
    const scroller = scrollRef.current;
    scroller?.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: "smooth" });
  }

  const todayX = geometry.centerOf(todayDay);
  const actualX = actualDay !== null ? geometry.centerOf(actualDay) : null;

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="overflow-x-auto overscroll-x-contain"
        onScroll={() => {
          recordAnchor();
          updateOverflowHints();
        }}
      >
        <div ref={trackRef} className="flex h-36 w-max" onKeyDown={handleKeyDown}>
          <button
            type="button"
            onClick={() => onExtend(-1)}
            className="flex h-full w-12 shrink-0 flex-col items-center justify-center gap-1 text-[10px] font-medium text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Show 30 earlier days"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
            30d
          </button>

          {/* flags and markers share this wrapper's origin with the day
              columns — the extend button above must stay outside it */}
          <div className="relative flex h-full">
          {segments.map((segment) =>
            segment.kind === "gap" ? (
              <button
                key={`gap-${segment.start}`}
                type="button"
                onClick={() => onGapTap(segment)}
                className="flex h-full w-16 shrink-0 flex-col items-center justify-center gap-1 border-x border-dashed border-border text-[10px] font-medium text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
                aria-label={
                  segment.days <= GAP_EXPAND_MAX
                    ? `Show the ${segment.days} hidden days`
                    : `${segment.days} empty days — jump to a date instead`
                }
              >
                <span aria-hidden>⋯</span>
                {gapLabel(segment.days)}
              </button>
            ) : (
              <div
                key={`days-${segment.start}`}
                className="relative h-full shrink-0"
                style={{ width: segment.count * DAY_W }}
              >
                {/* axis */}
                <div aria-hidden className="absolute inset-x-0 bottom-12 h-px bg-border-strong" />

                {/* day buttons: number below the axis, hit area past it */}
                <div className="absolute bottom-5 left-0 flex">
                  {Array.from({ length: segment.count }, (_, i) => {
                    const day = segment.start + i;
                    const entry = takenByDay.get(day);
                    const isSelected = selectedDay === day;
                    const weekend = dayOfWeek(day) === 0 || dayOfWeek(day) === 6;
                    return (
                      <button
                        key={day}
                        type="button"
                        data-day={day}
                        tabIndex={day === focusDay ? 0 : -1}
                        aria-pressed={isSelected || undefined}
                        aria-label={`${formatDateKey(dayIndexToDateKey(day))}${
                          entry
                            ? ` — claimed by ${entry.name}`
                            : interactive
                              ? " — open"
                              : ""
                        }`}
                        onClick={() => onDayTap(day)}
                        onFocus={() => onFocusDay(day)}
                        className={clsx(
                          "flex h-9 w-11 shrink-0 items-end justify-center rounded-md pb-1 text-[10px] tabular-nums",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                          isSelected
                            ? "bg-primary/15 font-bold text-primary"
                            : entry
                              ? "text-faint"
                              : interactive
                                ? clsx("hover:bg-surface-2", weekend ? "text-faint" : "text-muted")
                                : clsx("cursor-default", weekend ? "text-faint" : "text-muted"),
                        )}
                      >
                        {dayOfMonth(day)}
                      </button>
                    );
                  })}
                </div>

                {/* month strip; labels stick to the viewport edge while their month is in view */}
                <div aria-hidden className="absolute inset-x-0 bottom-0 flex h-5">
                  {/* no overflow-hidden here — it would break the sticky label */}
                  {monthSpans(segment.start, segment.count).map((span) => (
                    <div
                      key={span.label + span.x}
                      className="flex min-w-0 border-l border-border/60"
                      style={{ width: span.width }}
                    >
                      <span className="sticky left-2 self-center truncate whitespace-nowrap px-2 text-[10px] font-medium uppercase tracking-wide text-faint">
                        {span.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}

          {/* time markers + flags share the track-wide geometry */}
          {todayX !== null ? (
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-5 top-2 -translate-x-1/2"
              style={{ left: todayX }}
            >
              <div className="h-full border-l border-dashed border-border-strong" />
              <span className="absolute -top-1 left-1 text-[9px] font-medium uppercase text-faint">
                Today
              </span>
            </div>
          ) : null}
          {actualX !== null ? (
            <div
              className="pointer-events-none absolute bottom-5 top-0 z-20 -translate-x-1/2"
              style={{ left: actualX }}
            >
              <div className="mt-4 h-[calc(100%-1rem)] w-0.5 rounded-full bg-yes/70" />
              <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-yes-bg px-1.5 py-px text-[10px] font-semibold text-yes">
                Answer · {formatDateKey(dayIndexToDateKey(actualDay!), "short")}
              </span>
            </div>
          ) : null}
          {flags.map((flag) => {
            const x = geometry.centerOf(flag.day);
            if (x === null) return null;
            return (
              <GuessFlag
                key={flag.ghost ? "ghost" : flag.entry.userId}
                flag={flag}
                x={x}
                label={`${flag.ghost ? "Your pending date" : `${flag.entry.name}'s date`}: ${formatDateKey(flag.entry.dateKey)}`}
                onActivate={() => onFlagTap(flag)}
              />
            );
          })}
          </div>

          <button
            type="button"
            onClick={() => onExtend(1)}
            className="flex h-full w-12 shrink-0 flex-col items-center justify-center gap-1 text-[10px] font-medium text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Show 30 later days"
          >
            <ChevronRight className="size-3.5" aria-hidden />
            30d
          </button>
        </div>
      </div>

      {/* edge affordances: fades + page-scroll chevrons */}
      <div
        ref={leftFadeRef}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent transition-opacity"
      />
      <div
        ref={rightFadeRef}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent transition-opacity"
      />
      <button
        type="button"
        onClick={() => scrollByViewport(-1)}
        aria-label="Scroll earlier"
        className="absolute left-1 top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-muted shadow-sm transition-colors hover:text-foreground sm:flex"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => scrollByViewport(1)}
        aria-label="Scroll later"
        className="absolute right-1 top-1/2 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-muted shadow-sm transition-colors hover:text-foreground sm:flex"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
