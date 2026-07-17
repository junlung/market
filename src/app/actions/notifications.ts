"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/server/notification-service";
import type { ActionResult } from "@/lib/server/market-service";

// nav badge lives in the layout-rendered TopNav — items.ts "nav gem balance" precedent
function revalidateNotificationViews() {
  revalidatePath("/", "layout");
  revalidatePath("/notifications");
}

export async function markNotificationReadAction(notificationId: string): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = z.string().cuid().safeParse(notificationId);

  if (!parsed.success) {
    return { error: "Invalid notification reference." };
  }

  try {
    // ownership enforced in the service: the recipient-scoped updateMany
    // no-ops on anyone else's row
    await markNotificationRead(session.user.id, parsed.data);
    revalidateNotificationViews();
    return { success: "Marked read." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update notification." };
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const session = await requireSession();

  try {
    await markAllNotificationsRead(session.user.id);
    revalidateNotificationViews();
    return { success: "All caught up." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update notifications." };
  }
}
