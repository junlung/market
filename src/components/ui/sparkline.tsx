import { outcomeColorVar } from "@/lib/outcome-colors";

/**
 * Tiny server-rendered SVG sparkline of an outcome's probability (0..1),
 * step-after — parimutuel odds only change when a bet lands. Binary markets
 * keep the classic rising-green/falling-red look; multi-outcome markets pass
 * the leading outcome's `color` token instead.
 */
export function Sparkline({
  points,
  color,
  width = 72,
  height = 24,
}: {
  points: number[];
  /** Outcome color token — when set, overrides the rising/falling rule. */
  color?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return null;
  }

  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = innerW / (points.length - 1);
  const y = (p: number) => pad + (1 - Math.min(Math.max(p, 0), 1)) * innerH;

  let d = `M ${pad} ${y(points[0]).toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    const x = pad + i * stepX;
    d += ` H ${x.toFixed(2)} V ${y(points[i]).toFixed(2)}`;
  }

  const rising = points[points.length - 1] >= points[0];
  const stroke = color !== undefined ? outcomeColorVar(color) : rising ? "var(--yes)" : "var(--no)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
