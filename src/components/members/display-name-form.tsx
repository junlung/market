"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { updateDisplayNameAction } from "@/app/actions/members";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const initialState: ActionResult = {};

export function DisplayNameForm({ currentName }: { currentName: string }) {
  const toast = useToast();
  const router = useRouter();
  const { update } = useSession();
  const [name, setName] = useState(currentName);
  const [state, action, pending] = useActionState(updateDisplayNameAction, initialState);
  const lastHandled = useRef<ActionResult | null>(null);

  useEffect(() => {
    if (state === lastHandled.current) {
      return;
    }
    lastHandled.current = state;

    if (state.success) {
      toast.success(state.success);
      // refresh the JWT so the nav/avatar pick up the new name without re-login
      void update({ name: name.trim() }).then(() => router.refresh());
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const dirty = name.trim() !== currentName && name.trim().length >= 2;

  return (
    <form action={action} className="space-y-2 text-left">
      <Label htmlFor="dn-name">Display name</Label>
      <div className="flex gap-2">
        <Input
          id="dn-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={30}
          required
          className="flex-1"
        />
        <Button type="submit" size="md" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[11px] text-faint">
        Shown on the leaderboard, activity feed, and everywhere you bet.
      </p>
      <FieldError message={state.error} />
    </form>
  );
}
