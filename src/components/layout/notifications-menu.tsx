"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";
import { NotificationRowButton } from "@/components/layout/notification-row";
import type { NotificationRow } from "@/lib/server/notification-service";

export function NotificationsMenu({
  unreadCount,
  items,
}: {
  unreadCount: number;
  items: NotificationRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // local copy so mark-all-read clears the badge optimistically; server
  // re-renders (force-dynamic layout) reconcile it on navigation
  const [unread, setUnread] = useState(unreadCount);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setUnread(unreadCount), [unreadCount]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function markAllRead() {
    startTransition(async () => {
      setUnread(0);
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex size-9 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-fg">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-xs font-medium text-faint">Notifications</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-primary transition-colors hover:text-primary-hover"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Nothing yet. Place some bets and stir the pot.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {items.map((item) => (
                <NotificationRowButton key={item.id} item={item} onNavigate={() => setOpen(false)} />
              ))}
            </div>
          )}

          <div className="mt-1 border-t border-border pt-1">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-center text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              See all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
