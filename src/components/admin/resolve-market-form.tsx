"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { cancelMarketAction, resolveMarketAction } from "@/app/actions/markets";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";
import { formatPoints, formatSignedPoints } from "@/lib/format";

const initialState: ActionResult = {};

export type SettlementPreview = {
  outcome: "YES" | "NO";
  rows: Array<{
    userId: string;
    name: string;
    yesStake: number;
    noStake: number;
    payout: number;
    profit: number;
  }>;
  rake: number;
  dust: number;
};

export function ResolveMarketForm({
  marketId,
  resolutionSource,
  previews,
}: {
  marketId: string;
  resolutionSource: string;
  /** Server-computed dry-run settlements for both outcomes. */
  previews: SettlementPreview[];
}) {
  const [resolveState, resolveAction, resolving] = useActionState(resolveMarketAction, initialState);
  const [cancelState, cancelAction, canceling] = useActionState(cancelMarketAction, initialState);
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [showDanger, setShowDanger] = useState(false);

  const preview = previews.find((p) => p.outcome === outcome);

  return (
    <div className="space-y-4">
      <form action={resolveAction} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <input type="hidden" name="marketId" value={marketId} />
        <input type="hidden" name="outcome" value={outcome} />
        <h3 className="text-sm font-semibold">Resolve market</h3>

        <div className="flex gap-2">
          {(["YES", "NO"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setOutcome(option)}
              aria-pressed={outcome === option}
              className={clsx(
                "h-11 flex-1 rounded-lg text-sm font-bold transition-colors",
                outcome === option
                  ? option === "YES"
                    ? "bg-yes text-white"
                    : "bg-no text-white"
                  : option === "YES"
                    ? "bg-yes-bg text-yes"
                    : "bg-no-bg text-no",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        {preview ? (
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-xs font-medium text-muted">
              Payout preview if {outcome} — {formatPoints(preview.rake + preview.dust)} pts burned
              (rake{preview.dust > 0 ? " + dust" : ""})
            </p>
            {preview.rows.length === 0 ? (
              <p className="mt-2 text-xs text-faint">No stakes to settle.</p>
            ) : (
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="py-1 font-medium">Player</th>
                    <th className="py-1 text-right font-medium">Staked</th>
                    <th className="py-1 text-right font-medium">Payout</th>
                    <th className="py-1 text-right font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.userId} className="border-t border-border">
                      <td className="py-1.5 font-medium">{row.name}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatPoints(row.yesStake + row.noStake)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatPoints(row.payout)}</td>
                      <td
                        className={clsx(
                          "py-1.5 text-right font-semibold tabular-nums",
                          row.profit > 0 ? "text-yes" : row.profit < 0 ? "text-no" : "text-muted",
                        )}
                      >
                        {formatSignedPoints(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}

        <div>
          <Label htmlFor="rf-source">Resolution source</Label>
          <Input id="rf-source" name="resolutionSource" defaultValue={resolutionSource} required />
        </div>
        <div>
          <Label htmlFor="rf-notes">Notes</Label>
          <Textarea id="rf-notes" name="notes" placeholder="What happened, for the record." />
        </div>

        <FieldError message={resolveState.error} />
        {resolveState.success ? <p className="text-sm text-yes">{resolveState.success}</p> : null}

        <Button type="submit" variant={outcome === "YES" ? "yes" : "no"} disabled={resolving} className="w-full">
          {resolving ? "Resolving…" : `Resolve ${outcome} and pay out`}
        </Button>
      </form>

      <div className="rounded-xl border border-no/30 bg-surface p-5">
        <button
          type="button"
          onClick={() => setShowDanger((current) => !current)}
          className="text-sm font-semibold text-no"
        >
          {showDanger ? "▾" : "▸"} Danger zone — cancel &amp; refund
        </button>
        {showDanger ? (
          <form action={cancelAction} className="mt-3 space-y-3">
            <input type="hidden" name="marketId" value={marketId} />
            <div>
              <Label htmlFor="cf-reason">Refund reason</Label>
              <Textarea
                id="cf-reason"
                name="reason"
                placeholder="Example: event rules changed or source became invalid."
                required
              />
            </div>
            <FieldError message={cancelState.error} />
            {cancelState.success ? <p className="text-sm text-yes">{cancelState.success}</p> : null}
            <Button type="submit" variant="danger" disabled={canceling}>
              {canceling ? "Canceling…" : "Cancel market and refund all stakes"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
