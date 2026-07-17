"use client";

import { useActionState, useState } from "react";
import { deleteLeagueAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initialState: ActionResult = {};

/**
 * Owner-only danger zone: deleting erases the league's markets, bets, and
 * point history for every member, so the button stays dead until the owner
 * types the exact league name (the server re-checks the match).
 */
export function DeleteLeagueCard({
  leagueId,
  leagueName,
  seasonActive,
}: {
  leagueId: string;
  leagueName: string;
  seasonActive: boolean;
}) {
  const [state, formAction, pending] = useActionState(deleteLeagueAction, initialState);
  const [confirmName, setConfirmName] = useState("");
  const confirmed = confirmName.trim() === leagueName;

  return (
    <div className="rounded-xl border border-no/40 bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-no">Danger zone</p>
      {seasonActive ? (
        <p className="mt-2 text-sm text-muted">
          This league has a season in progress. It can be deleted once the season finishes.
        </p>
      ) : (
        <form action={formAction} className="mt-2 space-y-3">
          <input type="hidden" name="leagueId" value={leagueId} />
          <p className="text-sm text-muted">
            Deleting this league erases its markets, bets, and point history for every member —
            not just you. Season trophies already won are kept. This can&apos;t be undone.
          </p>
          <div className="space-y-1">
            <Label htmlFor="delete-league-confirm">
              Type <span className="font-semibold text-foreground">{leagueName}</span> to confirm
            </Label>
            <Input
              id="delete-league-confirm"
              name="confirmName"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              autoComplete="off"
              className="max-w-60"
            />
          </div>
          <Button type="submit" variant="danger" size="sm" disabled={!confirmed || pending}>
            {pending ? "Deleting…" : "Delete this league forever"}
          </Button>
          <FieldError message={state.error} />
        </form>
      )}
    </div>
  );
}
