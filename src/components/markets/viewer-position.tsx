import { estimatePayout } from "@/lib/parimutuel";
import { formatPoints, formatSignedPoints } from "@/lib/format";
import { outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";

/**
 * The viewer's stakes with what each would pay if the market settled on the
 * current pools — the honest "where do I stand right now" card.
 */
export function ViewerPositionCard({
  stakes,
  outcomes,
  rakeBps,
  voidAmount = 0,
}: {
  stakes: Array<{ outcomeId: string; amount: number }>;
  outcomes: Array<{ id: string; label: string; color: string; emoji?: string | null; pool: number }>;
  rakeBps: number;
  /** points placed after the betting cutoff — void, refunded at settlement */
  voidAmount?: number;
}) {
  const pot = outcomes.reduce((sum, outcome) => sum + outcome.pool, 0);

  const rows = stakes
    .filter((stake) => stake.amount > 0)
    .map((stake) => {
      const outcome = outcomes.find((candidate) => candidate.id === stake.outcomeId)!;
      return {
        ...stake,
        label: outcomeDisplayLabel(outcome),
        color: outcome.color,
        pays: estimatePayout({
          stake: stake.amount,
          winningPool: outcome.pool,
          losingPool: pot - outcome.pool,
          rakeBps,
        }),
      };
    });

  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Your position</p>
      <div className="mt-2 space-y-2.5">
        {rows.map((row) => (
          <div key={row.outcomeId} className="tabular-nums">
            <p className="flex justify-between">
              <span className="font-semibold" style={{ color: outcomeColorVar(row.color) }}>
                {row.label}
              </span>
              <span>{formatPoints(row.amount)} pts in</span>
            </p>
            <p className="mt-0.5 flex justify-between text-xs text-muted">
              <span>pays if {row.label} wins</span>
              <span>
                {formatPoints(row.pays)} pts{" "}
                <span className={row.pays - row.amount >= 0 ? "text-yes" : "text-no"}>
                  ({formatSignedPoints(row.pays - row.amount)})
                </span>
              </span>
            </p>
          </div>
        ))}
      </div>
      {voidAmount > 0 ? (
        <p className="mt-2.5 rounded-md bg-warn/10 p-2 text-xs font-medium text-warn">
          {formatPoints(voidAmount)} pts placed after the betting cutoff are void — they'll be
          refunded at settlement and pay nothing.
        </p>
      ) : null}
      <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-faint">
        Based on the pools right now — the real number is whatever they are at close.
      </p>
    </div>
  );
}
