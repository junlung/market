"use client";

import { useActionState } from "react";
import { joinLeagueAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";

const initialState: ActionResult = {};

/** The /join/[code] confirm button — wraps the code-join action, which redirects into the league. */
export function JoinConfirmButton({ code, leagueName }: { code: string; leagueName: string }) {
  const [state, formAction, pending] = useActionState(joinLeagueAction, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="code" value={code} />
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : `Join ${leagueName}`}
      </Button>
      <FieldError message={state.error} />
    </form>
  );
}
