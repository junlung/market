"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { updateUsernameAction } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { USERNAME_MAX, USERNAME_MIN } from "@/lib/username";

export function UsernameForm({ currentUsername }: { currentUsername: string }) {
  const toast = useToast();
  const router = useRouter();
  const { update } = useSession();
  const [username, setUsername] = useState(currentUsername);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // imperative action call, not useActionState — see display-name-form.tsx
  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await updateUsernameAction({}, formData);
      if (result.success) {
        toast.success(result.success);
        // refresh the JWT so profile links point at the new handle without re-login
        await update({ username: username.trim().toLowerCase() });
        router.refresh();
      } else if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  const normalized = username.trim().toLowerCase();
  const dirty = normalized !== currentUsername && normalized.length >= USERNAME_MIN;

  return (
    <form action={submit} className="space-y-2 text-left">
      <Label htmlFor="un-username">Username</Label>
      <div className="flex gap-2">
        <Input
          id="un-username"
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          minLength={USERNAME_MIN}
          maxLength={USERNAME_MAX}
          required
          className="flex-1"
        />
        <Button type="submit" size="md" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[11px] text-faint">
        Your profile handle — lowercase letters, numbers, and hyphens. Old profile links stop
        working when you change it.
      </p>
      <FieldError message={error ?? undefined} />
    </form>
  );
}
