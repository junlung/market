"use client";

import { useActionState } from "react";
import { setLeagueRoleAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";

const initialState: ActionResult = {};

/** Owner-only MOD/MEMBER toggle rendered next to each member row. */
export function MemberRoleToggle({
  leagueId,
  slug,
  userId,
  currentRole,
}: {
  leagueId: string;
  slug: string;
  userId: string;
  currentRole: "MOD" | "MEMBER";
}) {
  const [state, formAction, pending] = useActionState(setLeagueRoleAction, initialState);
  const nextRole = currentRole === "MOD" ? "MEMBER" : "MOD";

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="leagueId" value={leagueId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={nextRole} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Saving…" : currentRole === "MOD" ? "Remove mod" : "Make mod"}
      </Button>
      <FieldError message={state.error} />
    </form>
  );
}
