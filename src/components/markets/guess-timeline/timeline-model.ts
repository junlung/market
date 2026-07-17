import type { EquippedCosmetics } from "@/lib/cosmetics";
import { DAY_MS, monthLabelForDayIndex } from "@/lib/guess-dates";

/** One claimed date on the board, as the timeline consumes it. */
export type TimelineGuess = {
  userId: string;
  name: string;
  username: string;
  cosmetics: EquippedCosmetics | null;
  /** yyyy-mm-dd — the guess identity (UTC calendar date). */
  dateKey: string;
  finalRank: number | null;
  payout: number | null;
};

export type GuessMarketStatus = "open" | "closed" | "resolved" | "canceled";

export const RANK_MEDALS = ["🥇", "🥈", "🥉"] as const;

/** Width of one day column, px. 44 keeps day buttons at thumb size on phones. */
export const DAY_W = 44;
/** Width of a collapsed-gap chip, px. */
export const GAP_W = 64;
/** Empty runs up to this many days render as days; longer ones collapse. */
const GAP_COLLAPSE_MIN = 30;
/** Tapping a collapsed gap expands it in place only up to this many days. */
export const GAP_EXPAND_MAX = 120;
/** Days of context rendered around each claimed/selected/actual date. */
const ANCHOR_PAD = 10;

/** Inclusive day-index range that must render at day resolution. */
export type DayWindow = { start: number; end: number };

export type TimelineSegment =
  | { kind: "days"; start: number; count: number }
  | { kind: "gap"; start: number; end: number; days: number };

export function windowAround(day: number): DayWindow {
  return { start: day - ANCHOR_PAD, end: day + ANCHOR_PAD };
}

export function gapKey(gap: { start: number; end: number }): string {
  return `${gap.start}:${gap.end}`;
}

export function gapLabel(days: number): string {
  return days < 60 ? `${days}d` : `${Math.round(days / 30.44)}mo`;
}

/**
 * Merge the required day windows into contiguous day segments, collapsing
 * long empty runs between them into gap chips. Guess dates are unbounded, so
 * a uniform ruler is untenable — this is what keeps a two-year spread
 * scrollable instead of 30,000px wide.
 */
export function buildSegments(
  windows: DayWindow[],
  expandedGaps: ReadonlySet<string>,
): TimelineSegment[] {
  if (windows.length === 0) {
    return [];
  }
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: DayWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.start - last.end - 1 <= GAP_COLLAPSE_MIN) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }

  const segments: TimelineSegment[] = [];
  for (const [index, window] of merged.entries()) {
    const previous = merged[index - 1];
    if (previous) {
      const gap = { start: previous.end + 1, end: window.start - 1 };
      const days = gap.end - gap.start + 1;
      if (expandedGaps.has(gapKey(gap)) && days <= GAP_EXPAND_MAX) {
        // user opened this gap — absorb it and this window into the last run
        const last = segments[segments.length - 1] as Extract<TimelineSegment, { kind: "days" }>;
        last.count = window.end - last.start + 1;
        continue;
      }
      segments.push({ kind: "gap", ...gap, days });
    }
    segments.push({ kind: "days", start: window.start, count: window.end - window.start + 1 });
  }
  return segments;
}

/** Horizontal geometry of a segment list: day → px and back. */
export function buildGeometry(segments: TimelineSegment[]) {
  const placed: Array<{ segment: TimelineSegment; x: number }> = [];
  let x = 0;
  for (const segment of segments) {
    placed.push({ segment, x });
    x += segment.kind === "days" ? segment.count * DAY_W : GAP_W;
  }
  const totalWidth = x;

  /** px of a day column's center, or null if the day sits inside a gap. */
  function centerOf(day: number): number | null {
    for (const { segment, x: left } of placed) {
      if (segment.kind === "days" && day >= segment.start && day < segment.start + segment.count) {
        return left + (day - segment.start) * DAY_W + DAY_W / 2;
      }
    }
    return null;
  }

  /** Nearest rendered day at a px position — inverse of centerOf. */
  function dayAt(pxX: number): number | null {
    for (const { segment, x: left } of placed) {
      const width = segment.kind === "days" ? segment.count * DAY_W : GAP_W;
      if (pxX < left + width) {
        if (segment.kind === "days") {
          const offset = Math.min(segment.count - 1, Math.max(0, Math.floor((pxX - left) / DAY_W)));
          return segment.start + offset;
        }
        return segment.start - 1; // gap: snap to the day before it
      }
    }
    const last = placed[placed.length - 1];
    if (!last) return null;
    return last.segment.kind === "days"
      ? last.segment.start + last.segment.count - 1
      : last.segment.end;
  }

  return { totalWidth, centerOf, dayAt };
}

/** All day indexes rendered at day resolution, ascending. */
export function renderedDays(segments: TimelineSegment[]): number[] {
  const days: number[] = [];
  for (const segment of segments) {
    if (segment.kind === "days") {
      for (let d = segment.start; d < segment.start + segment.count; d++) {
        days.push(d);
      }
    }
  }
  return days;
}

/** Month strips inside one days-segment, x/width relative to the segment. */
export function monthSpans(
  start: number,
  count: number,
): Array<{ x: number; width: number; label: string }> {
  const spans: Array<{ x: number; width: number; label: string }> = [];
  let spanStart = start;
  let label = monthLabelForDayIndex(start);
  for (let day = start + 1; day < start + count; day++) {
    const dayLabel = monthLabelForDayIndex(day);
    if (dayLabel !== label) {
      spans.push({ x: (spanStart - start) * DAY_W, width: (day - spanStart) * DAY_W, label });
      spanStart = day;
      label = dayLabel;
    }
  }
  spans.push({ x: (spanStart - start) * DAY_W, width: (start + count - spanStart) * DAY_W, label });
  return spans;
}

/**
 * Flags on adjacent days alternate between a short and a tall pole so their
 * heads never overlap. Same-day collisions are impossible ([marketId, value]
 * is unique), so two lanes always suffice.
 */
export function assignLanes(sortedDays: number[]): Map<number, 0 | 1> {
  const lanes = new Map<number, 0 | 1>();
  for (const [index, day] of sortedDays.entries()) {
    const previous = sortedDays[index - 1];
    const previousLane = previous !== undefined ? lanes.get(previous) : undefined;
    lanes.set(day, previous !== undefined && day - previous <= 1 && previousLane === 0 ? 1 : 0);
  }
  return lanes;
}

/** Day-of-week for a day index (0 = Sunday). Epoch day 0 was a Thursday. */
export function dayOfWeek(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** Day of month (1–31) for a day index. */
export function dayOfMonth(day: number): number {
  return new Date(day * DAY_MS).getUTCDate();
}
