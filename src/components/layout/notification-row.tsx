"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useTransition } from "react";
import {
  AlarmClock,
  Bell,
  CircleCheck,
  CircleOff,
  Lightbulb,
  MessageSquarePlus,
  PartyPopper,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
} from "lucide-react";
import type { NotificationType } from "@prisma/client";
import clsx from "clsx";
import { markNotificationReadAction } from "@/app/actions/notifications";
import type { NotificationRow } from "@/lib/server/notification-service";
import { formatRelativeTime } from "@/lib/format";

const TYPE_ICONS: Record<NotificationType, typeof Bell> = {
  PROPOSAL_SUBMITTED: Lightbulb,
  MEMBER_PENDING: UserPlus,
  FEEDBACK_SUBMITTED: MessageSquarePlus,
  MARKET_AWAITING_RESOLUTION: AlarmClock,
  MARKET_RESOLVED: CircleCheck,
  MARKET_CANCELED: CircleOff,
  PROPOSAL_APPROVED: ThumbsUp,
  PROPOSAL_REJECTED: ThumbsDown,
  MEMBER_APPROVED: PartyPopper,
};

// clicking marks the row read, then navigates — the destination renders with
// the badge already correct server-side
export function NotificationRowButton({
  item,
  onNavigate,
}: {
  item: NotificationRow;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Icon = TYPE_ICONS[item.type] ?? Bell;
  const unread = item.readAt === null;

  function open() {
    startTransition(async () => {
      onNavigate?.();
      if (unread) {
        await markNotificationReadAction(item.id);
      }
      // href is server-constructed at emission (marketPath or an admin route),
      // stored as a plain string — safe to cast for typed routes
      router.push(item.href as Route);
    });
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={pending}
      className={clsx(
        "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-2",
        unread ? "bg-surface-2/50" : undefined,
      )}
    >
      <Icon className={clsx("mt-0.5 size-4 shrink-0", unread ? "text-primary" : "text-faint")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {unread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
          <span className={clsx("truncate text-sm", unread ? "font-semibold" : "font-medium text-muted")}>
            {item.title}
          </span>
        </span>
        {item.body ? <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{item.body}</span> : null}
        <span className="mt-0.5 block text-[11px] text-faint">{formatRelativeTime(item.createdAt)}</span>
      </span>
    </button>
  );
}
