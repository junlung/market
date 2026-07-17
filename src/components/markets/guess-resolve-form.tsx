"use client";

import { useActionState, useState } from "react";
import { cancelMarketAction, resolveGuessMarketAction } from "@/app/actions/markets";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";

const initialState: ActionResult = {};

/** Resolve a closest-guess market against the actual date (plus the cancel danger zone). */
export function GuessResolveForm({
  marketId,
  resolutionSource,
}: {
  marketId: string;
  resolutionSource: string;
}) {
  const [resolveState, resolveAction, resolving] = useActionState(
    resolveGuessMarketAction,
    initialState,
  );
  const [cancelState, cancelAction, canceling] = useActionState(cancelMarketAction, initialState);
  const [actual, setActual] = useState("");
  const [showDanger, setShowDanger] = useState(false);

  // pinned to UTC midnight like the guesses themselves
  const iso = actual ? `${actual}T00:00:00.000Z` : "";

  return (
    <div className="space-y-4">
      <form action={resolveAction} className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <input type="hidden" name="marketId" value={marketId} />
        <input type="hidden" name="actualValue" value={iso} />
        <h3 className="text-sm font-semibold">Resolve market</h3>
        <div>
          <Label htmlFor="grf-actual">The actual date</Label>
          <Input
            id="grf-actual"
            type="date"
            value={actual}
            onChange={(event) => setActual(event.target.value)}
            required
          />
          <p className="mt-1 text-xs text-faint">
            Guesses rank by distance from this date — closest three split the pot 60/25/15, ties
            share.
          </p>
        </div>
        <div>
          <Label htmlFor="grf-source">Resolution source</Label>
          <Textarea id="grf-source" name="resolutionSource" defaultValue={resolutionSource} required />
        </div>
        <div>
          <Label htmlFor="grf-notes">Notes</Label>
          <Textarea id="grf-notes" name="notes" placeholder="What happened, for the record." />
        </div>
        <FieldError message={resolveState.error} />
        {resolveState.success ? <p className="text-sm text-yes">{resolveState.success}</p> : null}
        <Button type="submit" disabled={resolving || !actual} className="w-full">
          {resolving ? "Resolving…" : "Resolve and pay the podium"}
        </Button>
      </form>

      <div className="rounded-xl border border-no/30 bg-surface p-5">
        <button
          type="button"
          onClick={() => setShowDanger((current) => !current)}
          className="text-sm font-semibold text-no"
        >
          {showDanger ? "▾" : "▸"} Danger zone — cancel &amp; refund antes
        </button>
        {showDanger ? (
          <form action={cancelAction} className="mt-3 space-y-3">
            <input type="hidden" name="marketId" value={marketId} />
            <div>
              <Label htmlFor="gcf-reason">Refund reason</Label>
              <Textarea id="gcf-reason" name="reason" required minLength={5} />
            </div>
            <FieldError message={cancelState.error} />
            <Button type="submit" variant="danger" disabled={canceling}>
              {canceling ? "Canceling…" : "Cancel market and refund every ante"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
