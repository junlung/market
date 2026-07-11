"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { formatChance } from "@/lib/format";
import { outcomeColorVar } from "@/lib/outcome-colors";
import { OutcomeDot } from "@/components/markets/outcome-dot";

export type ChartOutcome = { id: string; label: string; color: string };
export type ChartPoint = { t: number; probs: number[] };

const RANGES = [
  { id: "1D", ms: 24 * 60 * 60 * 1000 },
  { id: "1W", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "ALL", ms: Infinity },
] as const;

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 10, right: 44, bottom: 22, left: 8 };

/**
 * Step-after lines of each outcome's probability over time. Parimutuel odds
 * only move when a bet lands, so interpolating between points would
 * misrepresent the data — the step is the truth.
 *
 * Binary markets draw only the Yes-side series with an area fill (the classic
 * look); multi-outcome markets draw every series with no fill, the current
 * leader last with a surface under-stroke (coincident lines are the norm at
 * 1/N starts), plus legend chips and an all-outcomes crosshair tooltip.
 */
export function OddsChart({
  outcomes,
  points,
  endTime,
}: {
  outcomes: ChartOutcome[];
  points: ChartPoint[];
  endTime?: number;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("ALL");
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const isBinary = outcomes.length === 2;
  // binary markets chart the Yes side only; multi charts every outcome
  const seriesIndexes = isBinary ? [0] : outcomes.map((_, index) => index);

  const { paths, areaPath, visible, tMin, tMax, drawOrder } = useMemo(() => {
    const now = endTime ?? points[points.length - 1]?.t ?? Date.now();
    const rangeMs = RANGES.find((r) => r.id === range)?.ms ?? Infinity;
    const cutoff = rangeMs === Infinity ? -Infinity : now - rangeMs;

    // keep the last point before the cutoff so the steps enter from the left edge
    let visible = points.filter((point) => point.t >= cutoff);
    const before = points.filter((point) => point.t < cutoff);
    if (before.length > 0) {
      visible = [{ t: cutoff, probs: before[before.length - 1].probs }, ...visible];
    }
    if (visible.length === 0) {
      visible = points.slice(-1);
    }

    const tMin = visible[0]?.t ?? now - 1;
    const tMax = Math.max(now, visible[visible.length - 1]?.t ?? now);
    const span = Math.max(tMax - tMin, 1);

    const x = (t: number) => PAD.left + ((t - tMin) / span) * (WIDTH - PAD.left - PAD.right);
    const y = (p: number) => PAD.top + (1 - p) * (HEIGHT - PAD.top - PAD.bottom);

    const paths = seriesIndexes.map((seriesIndex) => {
      let path = "";
      for (let i = 0; i < visible.length; i += 1) {
        const px = x(visible[i].t);
        const py = y(visible[i].probs[seriesIndex]);
        if (i === 0) {
          path = `M ${px.toFixed(1)} ${py.toFixed(1)}`;
        } else {
          path += ` H ${px.toFixed(1)} V ${py.toFixed(1)}`;
        }
      }
      // extend the last value to "now"
      if (visible.length > 0) {
        path += ` H ${x(tMax).toFixed(1)}`;
      }
      return path;
    });

    const baseline = y(0);
    const areaPath = isBinary
      ? `${paths[0]} V ${baseline.toFixed(1)} H ${x(tMin).toFixed(1)} Z`
      : null;

    // leader drawn last so it stays legible where lines coincide
    const lastProbs = visible[visible.length - 1]?.probs ?? [];
    const drawOrder = [...seriesIndexes].sort(
      (a, b) => (lastProbs[a] ?? 0) - (lastProbs[b] ?? 0),
    );

    return { paths, areaPath, visible, tMin, tMax, drawOrder };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, range, endTime, isBinary, outcomes.length]);

  const scaleX = (t: number) =>
    PAD.left + ((t - tMin) / Math.max(tMax - tMin, 1)) * (WIDTH - PAD.left - PAD.right);
  const scaleY = (p: number) => PAD.top + (1 - p) * (HEIGHT - PAD.top - PAD.bottom);

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || visible.length === 0) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    const t = tMin + ((event.clientX - rect.left) / rect.width) * (tMax - tMin);
    // step-after: the active point is the last one at or before t
    let active = visible[0];
    for (const point of visible) {
      if (point.t <= t) {
        active = point;
      } else {
        break;
      }
    }
    setHover(active);
  }

  const gridLines = [0.25, 0.5, 0.75];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        {!isBinary ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {outcomes.map((outcome) => (
              <span key={outcome.id} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                <OutcomeDot color={outcome.color} />
                <span className="max-w-28 truncate">{outcome.label}</span>
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={clsx(
                "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
                range === r.id ? "bg-surface-2 text-foreground" : "text-faint hover:text-muted",
              )}
            >
              {r.id}
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-48 w-full touch-none sm:h-60"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={
          isBinary ? `${outcomes[0].label} probability over time` : "Outcome probabilities over time"
        }
      >
        {gridLines.map((line) => (
          <g key={line}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={scaleY(line)}
              y2={scaleY(line)}
              stroke="var(--border)"
              strokeWidth={line === 0.5 ? 1.25 : 1}
              strokeDasharray={line === 0.5 ? undefined : "3 4"}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={WIDTH - PAD.right + 6}
              y={scaleY(line) + 3.5}
              fontSize="11"
              fill="var(--faint)"
              className="tabular-nums"
            >
              {Math.round(line * 100)}%
            </text>
          </g>
        ))}

        {isBinary && areaPath ? (
          <path d={areaPath} fill={outcomeColorVar(outcomes[0].color)} opacity="0.08" />
        ) : null}

        {drawOrder.map((seriesIndex, position) => {
          const isTop = position === drawOrder.length - 1;
          return (
            <g key={outcomes[seriesIndex].id}>
              {!isBinary && isTop ? (
                // surface under-stroke keeps the leader visible over coincident lines
                <path
                  d={paths[seriesIndexes.indexOf(seriesIndex)]}
                  fill="none"
                  stroke="var(--surface)"
                  strokeWidth="4"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              <path
                d={paths[seriesIndexes.indexOf(seriesIndex)]}
                fill="none"
                stroke={outcomeColorVar(outcomes[seriesIndex].color)}
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {hover ? (
          <g>
            <line
              x1={scaleX(hover.t)}
              x2={scaleX(hover.t)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {seriesIndexes.map((seriesIndex) => (
              <circle
                key={outcomes[seriesIndex].id}
                cx={scaleX(hover.t)}
                cy={scaleY(hover.probs[seriesIndex])}
                r="4"
                fill={outcomeColorVar(outcomes[seriesIndex].color)}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            ))}
          </g>
        ) : null}
      </svg>

      <div className="mt-1 flex min-h-5 items-center justify-between gap-3 text-xs text-faint">
        {hover ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 font-medium text-muted">
            <span className="shrink-0">
              {new Date(hover.t).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            {isBinary ? (
              <span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatChance(hover.probs[0])}
                </span>{" "}
                {outcomes[0].label.toLowerCase()}
              </span>
            ) : (
              // the crosshair reports every outcome at time t
              outcomes.map((outcome, index) => (
                <span key={outcome.id} className="inline-flex items-center gap-1">
                  <OutcomeDot color={outcome.color} />
                  <span className="max-w-24 truncate">{outcome.label}</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatChance(hover.probs[index])}
                  </span>
                </span>
              ))
            )}
          </span>
        ) : (
          <>
            <span>
              {new Date(tMin).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            <span>
              {new Date(tMax).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
