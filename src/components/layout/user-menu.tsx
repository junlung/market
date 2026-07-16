"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { CircleUserRound, Crown, History, LogOut, MessageSquarePlus, PlusCircle, Shield, Store, User, UserPlus } from "lucide-react";
import { FeedbackDialog } from "@/components/layout/feedback-dialog";
import { MemberAvatar } from "@/components/members/member-avatar";
import type { FrameStyle } from "@/lib/cosmetics";

export function UserMenu({
  name,
  username,
  isAdmin,
  frame,
}: {
  name: string;
  username: string;
  isAdmin: boolean;
  frame?: FrameStyle | null;
}) {
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center rounded-full transition-opacity hover:opacity-80"
      >
        <MemberAvatar name={name} size="md" frame={frame} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-52 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <p className="px-3 py-2 text-xs font-medium text-faint">{name}</p>
          <Link href={`/u/${username}`} className={itemClass} onClick={() => setOpen(false)}>
            <CircleUserRound className="size-4" /> Your profile
          </Link>
          <Link href="/account" className={itemClass} onClick={() => setOpen(false)}>
            <User className="size-4" /> Account
          </Link>
          <Link href="/history" className={itemClass} onClick={() => setOpen(false)}>
            <History className="size-4" /> Bet history
          </Link>
          <Link href="/markets/new" className={itemClass} onClick={() => setOpen(false)}>
            <PlusCircle className="size-4" /> Propose a market
          </Link>
          <Link href="/leagues" className={itemClass} onClick={() => setOpen(false)}>
            <Crown className="size-4" /> Leagues
          </Link>
          <Link href="/store" className={itemClass} onClick={() => setOpen(false)}>
            <Store className="size-4" /> Store
          </Link>
          <Link href="/invite" className={itemClass} onClick={() => setOpen(false)}>
            <UserPlus className="size-4" /> Invite friends
          </Link>
          {isAdmin ? (
            <Link href="/admin" className={itemClass} onClick={() => setOpen(false)}>
              <Shield className="size-4" /> Admin
            </Link>
          ) : null}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setFeedbackOpen(true);
            }}
          >
            <MessageSquarePlus className="size-4" /> Send feedback
          </button>
          <button type="button" className={itemClass} onClick={() => signOut({ callbackUrl: "/sign-in" })}>
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      ) : null}
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
