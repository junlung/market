import clsx from "clsx";
import { formatChance } from "@/lib/format";
import { outcomeColorVar } from "@/lib/outcome-colors";

/**
 * The atomic unit of the app: a market's implied chance. Binary markets keep
 * the classic green/red lean coloring (pass no `color`); multi-outcome
 * markets show the leading outcome in that outcome's own color.
 */
export function ProbabilityChip({
  probability,
  color,
  label,
  size = "md",
  showLabel = false,
  className,
}: {
  probability: number;
  /** Outcome color token — when set, overrides the green/red lean rule. */
  color?: string;
  /** Label under the number; defaults to "chance". */
  label?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showLabel?: boolean;
  className?: string;
}) {
  const leansYes = probability >= 0.5;

  const sizeClass = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
    xl: "text-4xl sm:text-5xl",
  }[size];

  return (
    <span className={clsx("inline-flex flex-col items-center leading-none", className)}>
      <span
        className={clsx(
          "font-bold tabular-nums",
          sizeClass,
          color === undefined && (leansYes ? "text-yes" : "text-no"),
        )}
        style={color !== undefined ? { color: outcomeColorVar(color) } : undefined}
      >
        {formatChance(probability)}
      </span>
      {showLabel ? (
        <span className="mt-0.5 max-w-24 truncate text-[10px] font-medium uppercase tracking-wide text-faint">
          {label ?? "chance"}
        </span>
      ) : null}
    </span>
  );
}
