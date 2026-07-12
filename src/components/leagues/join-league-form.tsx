"use client";

import { useActionState } from "react";
import { joinLeagueAction } from "@/app/actions/leagues";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initialState: ActionResult = {};

export function JoinLeagueForm() {
  const [state, formAction, pending] = useActionState(joinLeagueAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <Label htmlFor="jl-code">Invite code</Label>
        <Input
          id="jl-code"
          name="code"
          placeholder="ABCD-1234"
          autoComplete="off"
          className="font-mono uppercase"
          required
        />
      </div>
      <FieldError message={state.error} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Joining…" : "Join league"}
      </Button>
    </form>
  );
}
