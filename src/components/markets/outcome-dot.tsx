import clsx from "clsx";
import { outcomeColorVar } from "@/lib/outcome-colors";

/** The color swatch that accompanies every outcome label. */
export function OutcomeDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: outcomeColorVar(color) }}
    />
  );
}
