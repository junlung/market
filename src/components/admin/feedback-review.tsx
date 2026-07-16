"use client";

import { useActionState } from "react";
import { resolveFeedbackAction } from "@/app/actions/feedback";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";

const initialState: ActionResult = {};

export function FeedbackReview({ feedbackId, resolved }: { feedbackId: string; resolved: boolean }) {
  const [state, formAction, pending] = useActionState(resolveFeedbackAction, initialState);

  return (
    <form action={formAction} className="space-y-1 text-right">
      <input type="hidden" name="feedbackId" value={feedbackId} />
      {resolved ? null : <input type="hidden" name="resolve" value="1" />}
      <Button type="submit" variant={resolved ? "ghost" : "yes"} size="sm" disabled={pending}>
        {pending ? (resolved ? "Reopening…" : "Resolving…") : resolved ? "Reopen" : "Resolve"}
      </Button>
      <FieldError message={state.error} />
    </form>
  );
}
