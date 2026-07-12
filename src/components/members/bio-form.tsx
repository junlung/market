"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBioAction } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function BioForm({ currentBio }: { currentBio: string }) {
  const toast = useToast();
  const router = useRouter();
  const [bio, setBio] = useState(currentBio);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // imperative action call, not useActionState — see display-name-form.tsx
  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await updateBioAction({}, formData);
      if (result.success) {
        toast.success(result.success);
        router.refresh();
      } else if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  const dirty = bio.trim() !== currentBio;

  return (
    <form action={submit} className="space-y-2 text-left">
      <Label htmlFor="bio-body">Bio</Label>
      <Textarea
        id="bio-body"
        name="bio"
        value={bio}
        onChange={(event) => setBio(event.target.value)}
        maxLength={280}
        rows={3}
        placeholder="Shown on your profile. Trash talk welcome."
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-faint tabular-nums">{bio.trim().length}/280</p>
        <Button type="submit" size="md" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <FieldError message={error ?? undefined} />
    </form>
  );
}
