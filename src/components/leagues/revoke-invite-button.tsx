"use client";

import { useActionState } from "react";
import { revokeLeagueInviteAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";

const initialState: ActionResult = {};

export function RevokeInviteButton({ inviteId, slug }: { inviteId: string; slug: string }) {
  const [state, formAction, pending] = useActionState(revokeLeagueInviteAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      <input type="hidden" name="slug" value={slug} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      <FieldError message={state.error} />
    </form>
  );
}
