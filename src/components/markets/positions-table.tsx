import clsx from "clsx";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { OutcomeDot } from "@/components/markets/outcome-dot";
import { formatPercent0, formatPoints, formatSignedPoints } from "@/lib/format";

export type PositionOutcome = {
  id: string;
  label: string;
  color: string;
};

export type PositionRow = {
  userId: string;
  name: string;
  stakes: Array<{ outcomeId: string; amount: number }>;
  staked: number;
  potShare: number;
  settlementAmount: number;
  profit: number;
  resultLabel: string | null;
};

export function PositionsTable({
  rows,
  outcomes,
  viewerId,
  settled,
}: {
  rows: PositionRow[];
  outcomes: PositionOutcome[];
  viewerId: string;
  settled: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No stakes yet — be the first in the pool.</p>;
  }

  const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
            <th className="py-2 pr-3 font-medium">Player</th>
            <th className="py-2 pr-3 font-medium">Position</th>
            <th className="py-2 pr-3 text-right font-medium">Total</th>
            <th className="py-2 pr-3 text-right font-medium">Pot share</th>
            {settled ? (
              <>
                <th className="py-2 pr-3 text-right font-medium">Result</th>
                <th className="py-2 text-right font-medium">P/L</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.userId} className={clsx(row.userId === viewerId && "bg-primary/5")}>
              <td className="py-2.5 pr-3">
                <span className="flex items-center gap-2 font-medium">
                  <Avatar name={row.name} size="xs" />
                  {row.name}
                  {row.userId === viewerId ? <span className="text-xs text-faint">(you)</span> : null}
                </span>
              </td>
              <td className="py-2.5 pr-3">
                <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {row.stakes
                    .filter((stake) => stake.amount > 0)
                    .map((stake) => {
                      const outcome = outcomeById.get(stake.outcomeId);
                      return outcome ? (
                        <span key={stake.outcomeId} className="inline-flex items-center gap-1.5 tabular-nums">
                          <OutcomeDot color={outcome.color} />
                          {formatPoints(stake.amount)} on {outcome.label}
                        </span>
                      ) : null;
                    })}
                </span>
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">{formatPoints(row.staked)}</td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-muted">
                {formatPercent0(row.potShare)}
              </td>
              {settled ? (
                <>
                  <td className="py-2.5 pr-3 text-right">
                    {row.resultLabel ? <StatusBadge label={row.resultLabel} /> : null}
                  </td>
                  <td
                    className={clsx(
                      "py-2.5 text-right font-semibold tabular-nums",
                      row.profit > 0 ? "text-yes" : row.profit < 0 ? "text-no" : "text-muted",
                    )}
                  >
                    {formatSignedPoints(row.profit)}
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
