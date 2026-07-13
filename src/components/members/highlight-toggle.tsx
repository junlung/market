"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Star } from "lucide-react";
import { toggleAchievementShowcaseAction } from "@/app/actions/achievements";
import { useToast } from "@/components/ui/toast";

/** Star toggle: pin/unpin an earned achievement on your profile highlights. */
export function HighlightToggle({ achievementKey, showcased }: { achievementKey: string; showcased: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await toggleAchievementShowcaseAction(achievementKey);
      if (result.success) {
        toast.success(result.success);
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={showcased ? "Remove from profile highlights" : "Highlight on your profile"}
      aria-label={showcased ? `Stop highlighting ${achievementKey}` : `Highlight ${achievementKey}`}
      aria-pressed={showcased}
      className={clsx(
        "shrink-0 rounded-full p-1.5 transition-colors hover:bg-surface-2 disabled:opacity-50",
        showcased ? "text-warn" : "text-faint hover:text-muted",
      )}
    >
      <Star className="size-4" fill={showcased ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}
