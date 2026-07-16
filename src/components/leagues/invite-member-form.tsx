"use client";

import { useActionState } from "react";
import { createLeagueInviteAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select } from "@/components/ui/input";

const initialState: ActionResult = {};

/** Owner/mod picker for inviting an approved member who isn't in the league yet. */
export function InviteMemberForm({
  leagueId,
  slug,
  candidates,
}: {
  leagueId: string;
  slug: string;
  candidates: Array<{ id: string; name: string; username: string }>;
}) {
  const [state, formAction, pending] = useActionState(createLeagueInviteAction, initialState);

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-muted">Everyone who can be invited is already here.</p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="slug" value={slug} />
      <Label htmlFor="invite-member">Invite a member</Label>
      <div className="flex items-center gap-2">
        <Select id="invite-member" name="userId" defaultValue="" required className="max-w-60">
          <option value="" disabled>
            Pick a member…
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} (@{candidate.username})
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Sending…" : "Invite"}
        </Button>
      </div>
      <FieldError message={state.error} />
      {state.success ? <p className="text-sm text-yes">{state.success}</p> : null}
    </form>
  );
}
