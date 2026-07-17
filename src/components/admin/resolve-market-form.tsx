"use client";

import { useActionState, useState } from "react";
import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
import { cancelMarketAction, resolveMarketAction } from "@/app/actions/markets";
import type { ActionResult } from "@/lib/server/market-service";
import { outcomeColorBg, outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";
import { formatPoints, formatSignedPoints } from "@/lib/format";

const initialState: ActionResult = {};

export type ResolveOutcome = {
  id: string;
  label: string;
  color: string;
  emoji?: string | null;
  pool: number;
};

export type SettlementPreview = {
  outcomeId: string;
  rows: Array<{
    userId: string;
    name: string;
    staked: number;
    payout: number;
    profit: number;
    voidRefund: number;
  }>;
  rake: number;
  dust: number;
  mode: "NORMAL" | "REFUND_ALL" | "EMPTY";
};

function toInputDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ResolveMarketForm({
  marketId,
  resolutionSource,
  outcomes,
  previews,
  effectiveCloseAt,
}: {
  marketId: string;
  resolutionSource: string;
  outcomes: ResolveOutcome[];
  /** Server-computed dry-run settlements, one per outcome. */
  previews: SettlementPreview[];
  /** The stored betting cutoff, correctable here until resolution. */
  effectiveCloseAt?: Date | null;
}) {
  const [resolveState, resolveAction, resolving] = useActionState(resolveMarketAction, initialState);
  const [cancelState, cancelAction, canceling] = useActionState(cancelMarketAction, initialState);
  const [winningOutcomeId, setWinningOutcomeId] = useState<string>(outcomes[0].id);
  const [showDanger, setShowDanger] = useState(false);
  const [cutoff, setCutoff] = useState(effectiveCloseAt ? toInputDateTime(effectiveCloseAt) : "");

  const cutoffIso = (() => {
    if (!cutoff) {
      return "";
    }
    const parsed = new Date(cutoff);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  })();

  const winner = outcomes.find((outcome) => outcome.id === winningOutcomeId)!;
  const preview = previews.find((p) => p.outcomeId === winningOutcomeId);

  return (
    <div className="space-y-4">
      <form action={resolveAction} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <input type="hidden" name="marketId" value={marketId} />
        <input type="hidden" name="winningOutcomeId" value={winningOutcomeId} />
        <h3 className="text-sm font-semibold">Resolve market</h3>

        <div className={clsx(outcomes.length === 2 ? "flex gap-2" : "grid gap-2 sm:grid-cols-2")}>
          {outcomes.map((outcome) => {
            const active = winningOutcomeId === outcome.id;
            return (
              <button
                key={outcome.id}
                type="button"
                onClick={() => setWinningOutcomeId(outcome.id)}
                aria-pressed={active}
                className={clsx(
                  "flex h-11 min-w-0 items-center justify-between gap-2 rounded-lg px-3 text-sm font-bold transition-colors",
                  outcomes.length === 2 && "flex-1",
                  active && "text-white",
                )}
                style={
                  active
                    ? { background: outcomeColorVar(outcome.color) }
                    : { background: outcomeColorBg(outcome.color), color: outcomeColorVar(outcome.color) }
                }
              >
                <span className="truncate">{outcomeDisplayLabel(outcome)}</span>
                <span className="shrink-0 text-xs font-semibold opacity-80 tabular-nums">
                  {formatPoints(outcome.pool)} pts
                </span>
              </button>
            );
          })}
        </div>

        {preview?.mode === "REFUND_ALL" ? (
          <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <p>
              <span className="font-bold">Nobody backed {winner.label}.</span> Resolving this way
              refunds every stake in full — no winners, no rake. Double-check before you pull the
              trigger.
            </p>
          </div>
        ) : null}

        {preview ? (
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-xs font-medium text-muted">
              Payout preview if {winner.label} wins
              {preview.mode === "NORMAL"
                ? ` — ${formatPoints(preview.rake + preview.dust)} pts burned (rake${preview.dust > 0 ? " + dust" : ""})`
                : ""}
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
                      <td className="py-1.5 font-medium">
                        {row.name}
                        {row.voidRefund > 0 ? (
                          <span className="ml-1 text-[10px] font-semibold uppercase text-warn">
                            +{formatPoints(row.voidRefund)} void refund
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatPoints(row.staked)}</td>
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
          <Label htmlFor="rf-cutoff">Betting cutoff (optional)</Label>
          <input type="hidden" name="effectiveCloseAt" value={cutoffIso} />
          <Input
            id="rf-cutoff"
            type="datetime-local"
            value={cutoff}
            onChange={(event) => setCutoff(event.target.value)}
            className="max-w-56"
          />
          <p className="mt-1 text-xs text-faint">
            Bets placed after this moment are voided and refunded — use it when the market closed
            after the event actually happened. The preview above reflects the saved cutoff, not
            unsaved edits.
          </p>
        </div>
        <div>
          <Label htmlFor="rf-source">Resolution source</Label>
          <Textarea id="rf-source" name="resolutionSource" defaultValue={resolutionSource} required />
        </div>
        <div>
          <Label htmlFor="rf-notes">Notes</Label>
          <Textarea id="rf-notes" name="notes" placeholder="What happened, for the record." />
        </div>

        <FieldError message={resolveState.error} />
        {resolveState.success ? <p className="text-sm text-yes">{resolveState.success}</p> : null}

        <Button
          type="submit"
          disabled={resolving}
          className="w-full text-white"
          style={{ background: outcomeColorVar(winner.color) }}
        >
          {resolving
            ? "Resolving…"
            : preview?.mode === "REFUND_ALL"
              ? `Resolve ${winner.label} and refund everyone`
              : `Resolve ${winner.label} and pay out`}
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
