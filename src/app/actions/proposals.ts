"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession, requireSession } from "@/lib/session";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import {
  approveProposal,
  proposeMarket,
  rejectProposal,
  type ActionResult,
} from "@/lib/server/market-service";
import {
  describeValidationError,
  proposeMarketSchema,
  rejectProposalSchema,
  reviewProposalSchema,
} from "@/lib/validation";

function revalidateProposalViews(marketId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/admin/markets");
  if (marketId) {
    revalidatePath(`/admin/markets/${marketId}`);
    revalidatePath(`/markets/${marketId}`);
  }
}

export async function proposeMarketAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  await ensureWeeklyAllowance(session.user.id);

  const parsed = proposeMarketSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    closeTime: formData.get("closeTime"),
    resolveTime: formData.get("resolveTime"),
    resolutionSource: formData.get("resolutionSource"),
  });

  if (!parsed.success) {
    return { error: describeValidationError(parsed.error, "Enter valid market details.") };
  }

  try {
    await proposeMarket({
      proposerId: session.user.id,
      fields: {
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        closeTime: new Date(parsed.data.closeTime),
        resolveTime: new Date(parsed.data.resolveTime),
        resolutionSource: parsed.data.resolutionSource,
      },
    });
    revalidateProposalViews();
    return { success: "Proposal submitted — an admin will review it." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to submit proposal." };
  }
}

export async function approveProposalAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireAdminSession();
  const parsed = reviewProposalSchema.safeParse({
    marketId: formData.get("marketId"),
    note: formData.get("note") || undefined,
    openNow: formData.get("openNow") === "true",
  });

  if (!parsed.success) {
    return { error: "Invalid proposal review." };
  }

  try {
    await approveProposal(parsed.data.marketId, session.user.id, {
      note: parsed.data.note,
      openNow: parsed.data.openNow,
    });
    revalidateProposalViews(parsed.data.marketId);
    return { success: parsed.data.openNow ? "Proposal approved and opened." : "Proposal approved as draft." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to approve proposal." };
  }
}

export async function rejectProposalAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireAdminSession();
  const parsed = rejectProposalSchema.safeParse({
    marketId: formData.get("marketId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: "A rejection reason is required." };
  }

  try {
    await rejectProposal(parsed.data.marketId, session.user.id, parsed.data.reason);
    revalidateProposalViews(parsed.data.marketId);
    return { success: "Proposal rejected." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to reject proposal." };
  }
}
