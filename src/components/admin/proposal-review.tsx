"use client";

import { useActionState, useState } from "react";
import { approveProposalAction, rejectProposalAction } from "@/app/actions/proposals";
import type { ActionResult } from "@/lib/server/market-service";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initialState: ActionResult = {};

export function ProposalReview({ marketId }: { marketId: string }) {
  const [approveState, approveAction, approving] = useActionState(approveProposalAction, initialState);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectProposalAction, initialState);
  const [rejectOpen, setRejectOpen] = useState(false);

  return (
    <div className="space-y-3">
      <form action={approveAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="marketId" value={marketId} />
        <Button type="submit" name="openNow" value="true" variant="yes" size="sm" disabled={approving}>
          {approving ? "Working…" : "Approve & open"}
        </Button>
        <Button type="submit" variant="secondary" size="sm" disabled={approving}>
          Approve as draft
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setRejectOpen((v) => !v)}>
          Reject…
        </Button>
      </form>
      <FieldError message={approveState.error} />

      {rejectOpen ? (
        <form action={rejectAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="marketId" value={marketId} />
          <div className="min-w-56 flex-1">
            <Label htmlFor={`reject-${marketId}`}>Reason</Label>
            <Input id={`reject-${marketId}`} name="reason" placeholder="Too vague to resolve fairly" required />
          </div>
          <Button type="submit" variant="danger" size="md" disabled={rejecting}>
            {rejecting ? "Rejecting…" : "Reject"}
          </Button>
          <FieldError message={rejectState.error} />
        </form>
      ) : null}
    </div>
  );
}
