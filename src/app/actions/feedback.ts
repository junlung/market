"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession, requireSession } from "@/lib/session";
import { setFeedbackResolved, submitFeedback } from "@/lib/server/feedback-service";
import type { ActionResult } from "@/lib/server/market-service";
import { feedbackSchema, resolveFeedbackSchema } from "@/lib/validation";

function revalidateFeedbackViews() {
  revalidatePath("/admin");
  revalidatePath("/admin/feedback");
}

export async function submitFeedbackAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = feedbackSchema.safeParse({
    message: formData.get("message"),
    path: formData.get("path") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid feedback." };
  }

  try {
    await submitFeedback({
      userId: session.user.id,
      message: parsed.data.message,
      path: parsed.data.path,
    });
    revalidateFeedbackViews();
    return { success: "Feedback sent — thank you." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to send feedback." };
  }
}

export async function resolveFeedbackAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdminSession();
  const parsed = resolveFeedbackSchema.safeParse({
    feedbackId: formData.get("feedbackId"),
    resolve: formData.get("resolve") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid feedback reference." };
  }

  try {
    await setFeedbackResolved(parsed.data.feedbackId, Boolean(parsed.data.resolve));
    revalidateFeedbackViews();
    return { success: parsed.data.resolve ? "Marked resolved." : "Reopened." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update feedback." };
  }
}
