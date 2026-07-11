"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession, requireSession } from "@/lib/session";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { approveUser, rejectUser, updateDisplayName, vouchForUser } from "@/lib/server/member-service";
import type { ActionResult } from "@/lib/server/market-service";
import { displayNameSchema, rejectUserSchema, reviewUserSchema, vouchSchema } from "@/lib/validation";

function revalidateMemberViews() {
  revalidatePath("/invite");
  revalidatePath("/admin");
  revalidatePath("/admin/members");
}

export async function updateDisplayNameAction(
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = displayNameSchema.safeParse({ name: formData.get("name") });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  try {
    await updateDisplayName(session.user.id, parsed.data.name);
    // names render nearly everywhere (leaderboard, activity, positions)
    revalidatePath("/", "layout");
    return { success: "Name updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update name." };
  }
}

export async function vouchAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  await ensureWeeklyAllowance(session.user.id);

  const parsed = vouchSchema.safeParse({
    userId: formData.get("userId"),
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid vouch." };
  }

  try {
    await vouchForUser(parsed.data.userId, session.user.id, parsed.data.note);
    revalidateMemberViews();
    return { success: "Vouched — the admins will see it." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to vouch." };
  }
}

export async function approveUserAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireAdminSession();

  const parsed = reviewUserSchema.safeParse({
    userId: formData.get("userId"),
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid approval." };
  }

  try {
    const user = await approveUser(parsed.data.userId, session.user.id, parsed.data.note);
    revalidateMemberViews();
    return { success: `${user.name} is in — starting balance granted.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to approve member." };
  }
}

export async function rejectUserAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireAdminSession();

  const parsed = rejectUserSchema.safeParse({
    userId: formData.get("userId"),
    reason: formData.get("reason") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid rejection." };
  }

  try {
    await rejectUser(parsed.data.userId, session.user.id, parsed.data.reason);
    revalidateMemberViews();
    return { success: "Signup rejected." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to reject signup." };
  }
}
