"use server";

import { LeagueRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import { requireLeagueRole } from "@/lib/server/league-service";
import {
  approveProposal,
  proposeMarket,
  rejectProposal,
  requireMarketOperator,
  type ActionResult,
} from "@/lib/server/market-service";
import type { MarketFormState } from "@/app/actions/markets";
import {
  collectFieldErrors,
  proposeMarketSchema,
  rejectProposalSchema,
  reviewProposalSchema,
} from "@/lib/validation";

function revalidateProposalViews(marketId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/admin/markets");
  revalidatePath("/l", "layout");
  if (marketId) {
    revalidatePath(`/admin/markets/${marketId}`);
    revalidatePath(`/markets/${marketId}`);
  }
}

export async function proposeMarketAction(_: MarketFormState, formData: FormData): Promise<MarketFormState> {
  const session = await requireSession();
  await ensureWeeklyAllowance(session.user.id);

  // proposing into a custom league is for its members (any role)
  const leagueId = String(formData.get("leagueId") ?? "") || undefined;
  if (leagueId) {
    try {
      await requireLeagueRole(leagueId, session.user.id, [
        LeagueRole.OWNER,
        LeagueRole.MOD,
        LeagueRole.MEMBER,
      ]);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Not allowed." };
    }
  }

  const labels = formData.getAll("outcomeLabel").map(String);
  const colors = formData.getAll("outcomeColor").map(String);
  const emojis = formData.getAll("outcomeEmoji").map(String);

  const parsed = proposeMarketSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    closeTime: formData.get("closeTime"),
    resolveTime: formData.get("resolveTime"),
    resolutionSource: formData.get("resolutionSource"),
    outcomes: labels.map((label, index) => ({
      label,
      color: colors[index] ?? "",
      emoji: emojis[index] || undefined,
    })),
  });

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  try {
    await proposeMarket({
      leagueId,
      proposerId: session.user.id,
      fields: {
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        closeTime: new Date(parsed.data.closeTime),
        resolveTime: new Date(parsed.data.resolveTime),
        resolutionSource: parsed.data.resolutionSource,
      },
      outcomes: parsed.data.outcomes,
    });
    revalidateProposalViews();
    return {
      success: leagueId
        ? "Proposal submitted — the league owner will review it."
        : "Proposal submitted — an admin will review it.",
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to submit proposal." };
  }
}

export async function approveProposalAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = reviewProposalSchema.safeParse({
    marketId: formData.get("marketId"),
    note: formData.get("note") || undefined,
    openNow: formData.get("openNow") === "true",
  });

  if (!parsed.success) {
    return { error: "Invalid proposal review." };
  }

  try {
    await requireMarketOperator(parsed.data.marketId, session.user.id);
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
  const session = await requireSession();
  const parsed = rejectProposalSchema.safeParse({
    marketId: formData.get("marketId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: "A rejection reason is required." };
  }

  try {
    await requireMarketOperator(parsed.data.marketId, session.user.id);
    await rejectProposal(parsed.data.marketId, session.user.id, parsed.data.reason);
    revalidateProposalViews(parsed.data.marketId);
    return { success: "Proposal rejected." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to reject proposal." };
  }
}
