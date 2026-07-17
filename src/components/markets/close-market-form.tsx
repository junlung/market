"use client";

import { useState } from "react";
import { marketStatusAction } from "@/app/actions/markets";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/**
 * Close betting, optionally backdating the effective cutoff for event markets
 * closed after the fact — bets placed after the cutoff are voided and
 * refunded at settlement. The datetime-local value is converted to an ISO
 * instant client-side (the server can't know the browser's timezone).
 */
export function CloseMarketForm({
  marketId,
  size = "md",
}: {
  marketId: string;
  size?: "sm" | "md";
}) {
  const [backdate, setBackdate] = useState("");

  const iso = (() => {
    if (!backdate) {
      return "";
    }
    const parsed = new Date(backdate);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  })();

  return (
    <form action={marketStatusAction} className="space-y-2">
      <input type="hidden" name="marketId" value={marketId} />
      <input type="hidden" name="action" value="close" />
      <input type="hidden" name="effectiveCloseAt" value={iso} />
      <Button type="submit" variant="secondary" size={size}>
        {iso ? "Close betting (backdated)" : "Close betting now"}
      </Button>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Event already happened? Backdate the cutoff</summary>
        <div className="mt-2 space-y-1">
          <Label htmlFor={`close-cutoff-${marketId}`}>
            Bets placed after this moment are voided and refunded at settlement
          </Label>
          <Input
            id={`close-cutoff-${marketId}`}
            type="datetime-local"
            value={backdate}
            onChange={(event) => setBackdate(event.target.value)}
            className="max-w-56"
          />
        </div>
      </details>
    </form>
  );
}
