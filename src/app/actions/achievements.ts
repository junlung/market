"use server";

import { revalidatePath } from "next/cache";
import {
  getAchievementProgress,
  setShowcasedAchievements,
} from "@/lib/server/achievement-service";
import type { ActionResult } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

/** Toggles one achievement in/out of the viewer's profile highlights. */
export async function toggleAchievementShowcaseAction(key: string): Promise<ActionResult> {
  const session = await requireSession();

  try {
    const progress = await getAchievementProgress(session.user.id);
    const current = progress.filter((row) => row.showcased).map((row) => row.def.key);
    const next = current.includes(key as (typeof current)[number])
      ? current.filter((existing) => existing !== key)
      : [...current, key];

    await setShowcasedAchievements(session.user.id, next);
    revalidatePath("/u", "layout");
    return { success: next.length > current.length ? "Highlighted on your profile." : "Removed from highlights." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update highlights." };
  }
}
