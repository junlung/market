"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { formatChance } from "@/lib/format";

type Point = { t: number; p: number };

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
 * Step-after line of YES probability over time. Parimutuel odds only move
 * when a bet lands, so interpolating between points would misrepresent the
 * data — the step is the truth.
 */
export function OddsChart({ points, endTime }: { points: Point[]; endTime?: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("ALL");
  const [hover, setHover] = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { path, areaPath, visible, tMin, tMax } = useMemo(() => {
    const now = endTime ?? points[points.length - 1]?.t ?? Date.now();
    const rangeMs = RANGES.find((r) => r.id === range)?.ms ?? Infinity;
    const cutoff = rangeMs === Infinity ? -Infinity : now - rangeMs;

    // keep the last point before the cutoff so the step enters from the left edge
    let visible = points.filter((point) => point.t >= cutoff);
    const before = points.filter((point) => point.t < cutoff);
    if (before.length > 0) {
      visible = [{ t: cutoff, p: before[before.length - 1].p }, ...visible];
    }
    if (visible.length === 0) {
      visible = points.slice(-1);
    }

    const tMin = visible[0]?.t ?? now - 1;
    const tMax = Math.max(now, visible[visible.length - 1]?.t ?? now);
    const span = Math.max(tMax - tMin, 1);

    const x = (t: number) => PAD.left + ((t - tMin) / span) * (WIDTH - PAD.left - PAD.right);
    const y = (p: number) => PAD.top + (1 - p) * (HEIGHT - PAD.top - PAD.bottom);

    let path = "";
    for (let i = 0; i < visible.length; i += 1) {
      const px = x(visible[i].t);
      const py = y(visible[i].p);
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

    const baseline = y(0);
    const areaPath = `${path} V ${baseline.toFixed(1)} H ${x(tMin).toFixed(1)} Z`;

    return { path, areaPath, visible, tMin, tMax };
  }, [points, range, endTime]);

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
      <div className="mb-2 flex justify-end gap-1">
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

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-48 w-full touch-none sm:h-60"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Yes probability over time"
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

        <path d={areaPath} fill="var(--yes)" opacity="0.08" />
        <path
          d={path}
          fill="none"
          stroke="var(--yes)"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

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
            <circle
              cx={scaleX(hover.t)}
              cy={scaleY(hover.p)}
              r="4"
              fill="var(--yes)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
          </g>
        ) : null}
      </svg>

      <div className="mt-1 flex h-5 items-center justify-between text-xs text-faint">
        {hover ? (
          <span className="font-medium text-muted">
            {new Date(hover.t).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {" — "}
            <span className="font-semibold text-foreground tabular-nums">{formatChance(hover.p)}</span> yes
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
