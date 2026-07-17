"use client";

import { useActionState, useState } from "react";
import { placeGuessAction } from "@/app/actions/markets";
import type { ActionResult } from "@/lib/server/market-service";
import { formatPoints } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initialState: ActionResult = {};

// guess dates are calendar dates pinned to UTC midnight, so every browser
// agrees on which instant "Sep 10" is
function toInputDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

/**
 * Claim (or move) a date in a closest-guess market. Dates are unique per
 * market — first come, first claimed. The ante is charged once, on the first
 * claim; moving is free until close.
 */
export function GuessForm({
  marketId,
  ante,
  viewerGuess,
  takenDates,
}: {
  marketId: string;
  ante: number;
  viewerGuess: Date | null;
  /** already-claimed dates (yyyy-mm-dd), for instant feedback */
  takenDates: string[];
}) {
  const [state, formAction, pending] = useActionState(placeGuessAction, initialState);
  const [date, setDate] = useState(viewerGuess ? toInputDate(viewerGuess) : "");

  const mine = viewerGuess ? toInputDate(viewerGuess) : null;
  const taken = date !== "" && date !== mine && takenDates.includes(date);
  const iso = date ? `${date}T00:00:00.000Z` : "";

  return (
    <form action={formAction} className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">
        {viewerGuess ? "Your date" : "Claim a date"}
      </p>
      <input type="hidden" name="marketId" value={marketId} />
      <input type="hidden" name="value" value={iso} />
      <div className="flex items-end gap-2">
        <div>
          <Label htmlFor={`guess-date-${marketId}`} className="sr-only">
            Pick a date
          </Label>
          <Input
            id={`guess-date-${marketId}`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending || !date || taken || date === mine}>
          {pending ? "Claiming…" : viewerGuess ? "Move your date" : `Ante ${formatPoints(ante)} pts`}
        </Button>
      </div>
      {taken ? <p className="text-xs text-no">That date is already claimed.</p> : null}
      {!viewerGuess ? (
        <p className="text-xs text-faint">
          One date per player, first come first claimed. You can move it until close — the ante
          stays in the pot.
        </p>
      ) : null}
      <FieldError message={state.error} />
      {state.success ? <p className="text-sm text-yes">{state.success}</p> : null}
    </form>
  );
}
