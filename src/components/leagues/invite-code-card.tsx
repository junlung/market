"use client";

import { useState } from "react";
import { Check, Copy, Link as LinkIcon, RefreshCw } from "lucide-react";
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
  const [linkCopied, setLinkCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(formatInviteCode(code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
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
        <Button type="button" variant="ghost" size="sm" onClick={copyLink}>
          {linkCopied ? <Check className="size-4 text-yes" aria-hidden /> : <LinkIcon className="size-4" aria-hidden />}
          {linkCopied ? "Copied" : "Copy link"}
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
        Anyone with the code or link can join. Rotating kills both immediately.
      </p>
    </div>
  );
}
