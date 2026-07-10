"use server";

import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { createComment, deleteComment } from "@/lib/server/comment-service";
import type { ActionResult } from "@/lib/server/market-service";
import { commentSchema, deleteCommentSchema } from "@/lib/validation";

export async function createCommentAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  await ensureWeeklyAllowance(session.user.id);

  const parsed = commentSchema.safeParse({
    marketId: formData.get("marketId"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return { error: "Comments must be 1–500 characters." };
  }

  try {
    await createComment({
      userId: session.user.id,
      marketId: parsed.data.marketId,
      body: parsed.data.body,
    });
    revalidatePath(`/markets/${parsed.data.marketId}`);
    return { success: "Comment posted." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to post comment." };
  }
}

export async function deleteCommentAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = deleteCommentSchema.safeParse({
    commentId: formData.get("commentId"),
  });

  if (!parsed.success) {
    return { error: "Invalid comment." };
  }

  const marketId = String(formData.get("marketId") ?? "");

  try {
    await deleteComment(parsed.data.commentId, {
      id: session.user.id,
      role: session.user.role === "ADMIN" ? UserRole.ADMIN : UserRole.MEMBER,
    });
    if (marketId) {
      revalidatePath(`/markets/${marketId}`);
    }
    return { success: "Comment deleted." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete comment." };
  }
}
