"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { updateDisplayNameAction } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function DisplayNameForm({ currentName }: { currentName: string }) {
  const toast = useToast();
  const router = useRouter();
  const { update } = useSession();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // the action is invoked imperatively (not via useActionState): in
  // production builds, an action that revalidates the current page resets
  // useActionState to its initial value before the success ever renders —
  // a closure over the awaited result is immune to that
  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await updateDisplayNameAction({}, formData);
      if (result.success) {
        toast.success(result.success);
        // refresh the JWT so the nav picks up the new name without re-login
        await update({ name: name.trim() });
        router.refresh();
      } else if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  const dirty = name.trim() !== currentName && name.trim().length >= 2;

  return (
    <form action={submit} className="space-y-2 text-left">
      <Label htmlFor="dn-name">Display name</Label>
      <div className="flex gap-2">
        <Input
          id="dn-name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          minLength={2}
          maxLength={30}
          required
          className="flex-1"
        />
        <Button type="submit" size="md" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[11px] text-faint">
        Shown on the leaderboard, activity feed, and everywhere you bet.
      </p>
      <FieldError message={error ?? undefined} />
    </form>
  );
}
