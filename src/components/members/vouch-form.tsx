"use client";

import { useActionState, useState } from "react";
import { vouchAction } from "@/app/actions/members";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/input";

const initialState: ActionResult = {};

export function VouchForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(vouchAction, initialState);
  const [open, setOpen] = useState(false);

  if (state.success) {
    return <p className="text-xs font-medium text-yes">Vouched ✓</p>;
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Vouch for them
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Input name="note" placeholder="This is my roommate Dave — he's good for it" className="h-8 w-64 text-xs" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Vouching…" : "Vouch"}
      </Button>
      <FieldError message={state.error} />
    </form>
  );
}
