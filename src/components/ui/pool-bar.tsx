import clsx from "clsx";
import { outcomeColorVar } from "@/lib/outcome-colors";

const MIN_SLIVER_PERCENT = 2;

/** Thin split bar showing each outcome's share of the pool. */
export function PoolBar({
  outcomes,
  className,
}: {
  outcomes: Array<{ label: string; color: string; pool: number }>;
  className?: string;
}) {
  const total = outcomes.reduce((sum, outcome) => sum + outcome.pool, 0);

  // empty market: even split. Otherwise proportional, but a funded outcome
  // never shrinks below a visible sliver.
  const shares = outcomes.map((outcome) =>
    total > 0 ? Math.max((outcome.pool / total) * 100, outcome.pool > 0 ? MIN_SLIVER_PERCENT : 0) : 100 / outcomes.length,
  );
  const shareTotal = shares.reduce((sum, share) => sum + share, 0);

  return (
    <div
      className={clsx("flex h-1 w-full gap-[2px] overflow-hidden rounded-full", className)}
      role="img"
      aria-label={outcomes.map((outcome) => `${outcome.label} pool ${outcome.pool} points`).join(", ")}
    >
      {outcomes.map((outcome, index) =>
        shares[index] > 0 ? (
          <div
            key={outcome.label}
            className="rounded-full"
            style={{
              width: `${(shares[index] / shareTotal) * 100}%`,
              background: outcomeColorVar(outcome.color),
            }}
          />
        ) : null,
      )}
    </div>
  );
}
