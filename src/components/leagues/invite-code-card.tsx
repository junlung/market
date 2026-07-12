"use client";

import { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { rotateInviteCodeAction } from "@/app/actions/leagues";
import { Button } from "@/components/ui/button";
import { formatInviteCode } from "@/lib/leagues";

export function InviteCodeCard({
  leagueId,
  slug,
  code,
}: {
  leagueId: string;
  slug: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(formatInviteCode(code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Invite code</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-lg font-bold tracking-widest">
          {formatInviteCode(code)}
        </code>
        <Button type="button" variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="size-4 text-yes" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <form action={rotateInviteCodeAction}>
          <input type="hidden" name="leagueId" value={leagueId} />
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" variant="ghost" size="sm">
            <RefreshCw className="size-4" aria-hidden /> Rotate
          </Button>
        </form>
      </div>
      <p className="mt-2 text-xs text-faint">
        Anyone with this code can join. Rotating it kills the old code immediately.
      </p>
    </div>
  );
}
