"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerWithInvite, type SignUpFormState } from "@/app/actions/signup";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

const initialState: SignUpFormState = {};

export function SignUpForm() {
  const [state, action, pending] = useActionState(registerWithInvite, initialState);

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="name">Display name</Label>
        <Input id="name" name="name" type="text" placeholder="Taylor" required />
      </div>
      <div>
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          type="text"
          placeholder="taylor"
          minLength={3}
          maxLength={20}
          pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
          title="Lowercase letters, numbers, and hyphens"
          required
        />
        <p className="mt-1 text-[11px] text-faint">Your profile handle — lowercase letters, numbers, and hyphens.</p>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" placeholder="At least 8 characters" required />
      </div>
      <FieldError message={state.error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already registered?{" "}
        <Link className="font-medium text-primary hover:text-primary-hover" href="/sign-in">
          Sign in
        </Link>
      </p>
    </form>
  );
}
