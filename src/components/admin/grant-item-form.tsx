"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminGrantItemAction } from "@/app/actions/items";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Admin grant tool: hand any item to any active member (ADMIN_GRANT). */
export function GrantItemForm({
  itemId,
  members,
}: {
  itemId: string;
  members: Array<{ id: string; name: string }>;
}) {
  const toast = useToast();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await adminGrantItemAction({}, formData);
      if (result.success) {
        toast.success(result.success);
        setUserId("");
        router.refresh();
      } else if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="itemId" value={itemId} />
      <Label htmlFor="grant-user">Grant to a member</Label>
      <div className="flex gap-2">
        <Select
          id="grant-user"
          name="userId"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          required
          className="flex-1"
        >
          <option value="" disabled>
            Pick a member…
          </option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
        <Button type="submit" size="md" disabled={pending || !userId}>
          {pending ? "Granting…" : "Grant"}
        </Button>
      </div>
      <p className="text-[11px] text-faint">
        Lands in their locker as a special grant — great for one-off prizes.
      </p>
      <FieldError message={error ?? undefined} />
    </form>
  );
}
