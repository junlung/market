"use client";

import { useActionState } from "react";
import { acceptLeagueInviteAction, declineLeagueInviteAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";

const initialState: ActionResult = {};

/** Accept/decline pair on an invite row — accepting redirects into the league. */
export function InviteResponseButtons({ inviteId }: { inviteId: string }) {
  const [acceptState, acceptAction, accepting] = useActionState(
    acceptLeagueInviteAction,
    initialState,
  );
  const [declineState, declineAction, declining] = useActionState(
    declineLeagueInviteAction,
    initialState,
  );
  const pending = accepting || declining;

  return (
    <div>
      <div className="flex items-center gap-2">
        <form action={acceptAction}>
          <input type="hidden" name="inviteId" value={inviteId} />
          <Button type="submit" size="sm" disabled={pending}>
            {accepting ? "Joining…" : "Accept"}
          </Button>
        </form>
        <form action={declineAction}>
          <input type="hidden" name="inviteId" value={inviteId} />
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            {declining ? "Declining…" : "Decline"}
          </Button>
        </form>
      </div>
      <FieldError message={acceptState.error ?? declineState.error} />
    </div>
  );
}
