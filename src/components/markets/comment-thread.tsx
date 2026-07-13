"use client";

import { useActionState, useEffect, useOptimistic, useRef, startTransition } from "react";
import { createCommentAction } from "@/app/actions/comments";
import type { ActionResult } from "@/lib/server/market-service";
import { BadgeGlyph } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProfileLink } from "@/components/members/profile-link";
import type { EquippedCosmetics } from "@/lib/cosmetics";
import { formatRelativeTime } from "@/lib/format";

export type CommentItem = {
  id: string;
  body: string;
  userName: string;
  userUsername: string;
  userId: string;
  cosmetics?: EquippedCosmetics | null;
  createdAt: Date | string;
  pending?: boolean;
};

export function CommentThread({
  marketId,
  comments,
  viewerName,
  viewerUsername,
  viewerCosmetics,
}: {
  marketId: string;
  comments: CommentItem[];
  viewerName: string;
  viewerUsername: string;
  viewerCosmetics?: EquippedCosmetics | null;
}) {
  const [optimisticComments, addOptimistic] = useOptimistic(
    comments,
    (current, body: string) => [
      {
        id: `optimistic-${Date.now()}`,
        body,
        userName: viewerName,
        userUsername: viewerUsername,
        userId: "viewer",
        cosmetics: viewerCosmetics ?? null,
        createdAt: new Date(),
        pending: true,
      },
      ...current,
    ],
  );

  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(createCommentAction, {});

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <div>
      <form
        ref={formRef}
        action={(formData) => {
          const body = String(formData.get("body") ?? "").trim();
          if (body) {
            startTransition(() => addOptimistic(body));
          }
          formAction(formData);
        }}
        className="flex items-start gap-2.5"
      >
        <MemberAvatar name={viewerName} size="sm" frame={viewerCosmetics?.frame} className="mt-1" />
        <div className="flex-1">
          <textarea
            name="body"
            rows={2}
            maxLength={500}
            required
            placeholder="Add a comment — talk your trash"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          <input type="hidden" name="marketId" value={marketId} />
          <div className="mt-1.5 flex items-center justify-between">
            {state.error ? <p className="text-xs text-no">{state.error}</p> : <span />}
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {pending ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-4 divide-y divide-border">
        {optimisticComments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No comments yet. Set the tone.</p>
        ) : (
          optimisticComments.map((comment) => (
            <div key={comment.id} className={comment.pending ? "opacity-60" : undefined}>
              <div className="flex items-start gap-2.5 py-3">
                <ProfileLink username={comment.userUsername} className="mt-0.5 shrink-0">
                  <MemberAvatar name={comment.userName} size="sm" frame={comment.cosmetics?.frame} />
                </ProfileLink>
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <ProfileLink username={comment.userUsername} className="font-semibold text-foreground">
                      {comment.userName}
                    </ProfileLink>
                    <BadgeGlyph
                      badge={comment.cosmetics?.badge}
                      label={`${comment.userName}'s badge`}
                      className="ml-1"
                    />{" "}
                    <span className="text-faint">{formatRelativeTime(comment.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
