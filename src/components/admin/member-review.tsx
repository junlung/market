"use client";

import { useActionState, useState } from "react";
import { approveUserAction, rejectUserAction } from "@/app/actions/members";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/input";

const initialState: ActionResult = {};

export function MemberReview({ userId, canReject = true }: { userId: string; canReject?: boolean }) {
  const [approveState, approveAction, approving] = useActionState(approveUserAction, initialState);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectUserAction, initialState);
  const [rejectOpen, setRejectOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={approveAction}>
          <input type="hidden" name="userId" value={userId} />
          <Button type="submit" variant="yes" size="sm" disabled={approving}>
            {approving ? "Approving…" : "Approve"}
          </Button>
        </form>
        {canReject ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setRejectOpen((v) => !v)}>
            Reject…
          </Button>
        ) : null}
      </div>
      <FieldError message={approveState.error} />

      {canReject && rejectOpen ? (
        <form action={rejectAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={userId} />
          <Input name="reason" placeholder="Optional note (e.g. who is this?)" className="h-8 w-56 text-xs" />
          <Button type="submit" variant="danger" size="sm" disabled={rejecting}>
            {rejecting ? "Rejecting…" : "Reject"}
          </Button>
          <FieldError message={rejectState.error} />
        </form>
      ) : null}
    </div>
  );
}
