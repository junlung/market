import clsx from "clsx";
import { formatChance } from "@/lib/format";

/** The atomic unit of the app: a market's implied chance, colored by lean. */
export function ProbabilityChip({
  probability,
  size = "md",
  showLabel = false,
  className,
}: {
  probability: number;
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
        className={clsx("font-bold tabular-nums", sizeClass, leansYes ? "text-yes" : "text-no")}
      >
        {formatChance(probability)}
      </span>
      {showLabel ? <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">chance</span> : null}
    </span>
  );
}
