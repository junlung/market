"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
      onClick={() => signOut({ callbackUrl: "/sign-in" })}
      type="button"
    >
      Sign out
    </button>
  );
}
