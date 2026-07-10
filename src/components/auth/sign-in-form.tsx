"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOGIN_REDIRECT } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";

export function SignInForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const result = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });

    if (!result || result.error) {
      if (result?.error === "ACCOUNT_PENDING") {
        setError("Your account is waiting on admin approval — hang tight.");
      } else if (result?.error === "ACCOUNT_NOT_ACTIVE") {
        setError("This account isn't active. Talk to your league admin.");
      } else {
        setError("Email or password is incorrect.");
      }
      setPending(false);
      return;
    }

    router.push(DEFAULT_LOGIN_REDIRECT);
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@example.com" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" placeholder="••••••••" required />
      </div>
      <FieldError message={error ?? undefined} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted">
        Need an account?{" "}
        <Link className="font-medium text-primary hover:text-primary-hover" href="/sign-up">
          Use an invite
        </Link>
      </p>
    </form>
  );
}
