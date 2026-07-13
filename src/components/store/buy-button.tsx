"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { purchaseItemAction } from "@/app/actions/items";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function BuyButton({
  itemSlug,
  cost,
  disabled,
  shortfall,
}: {
  itemSlug: string;
  cost: number;
  disabled: boolean;
  shortfall: number;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function buy() {
    startTransition(async () => {
      const result = await purchaseItemAction(itemSlug);
      if (result.success) {
        toast.success(result.success);
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  }

  if (disabled) {
    return (
      <Button size="sm" disabled title={`You need ${shortfall} more gems`}>
        Need {shortfall} more
      </Button>
    );
  }

  return (
    <Button size="sm" disabled={pending} onClick={buy}>
      {pending ? "Buying…" : `Buy · ${cost}`}
    </Button>
  );
}
