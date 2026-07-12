"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { CircleUserRound, History, LogOut, PlusCircle, Shield, User, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

export function UserMenu({
  name,
  username,
  isAdmin,
}: {
  name: string;
  username: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
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
        className="flex items-center rounded-full transition-opacity hover:opacity-80"
      >
        <Avatar name={name} size="md" />
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
          <Link href="/invite" className={itemClass} onClick={() => setOpen(false)}>
            <UserPlus className="size-4" /> Invite friends
          </Link>
          {isAdmin ? (
            <Link href="/admin" className={itemClass} onClick={() => setOpen(false)}>
              <Shield className="size-4" /> Admin
            </Link>
          ) : null}
          <div className="my-1 border-t border-border" />
          <button type="button" className={itemClass} onClick={() => signOut({ callbackUrl: "/sign-in" })}>
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
