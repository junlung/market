"use server";

import { LeagueRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireAdminSession, requireSession } from "@/lib/session";
import { placeBet, recordBetFailure } from "@/lib/server/bet-service";
import { requireLeagueRole } from "@/lib/server/league-service";
import {
  cancelMarket,
  closeMarket,
  createMarket,
  openMarket,
  requireMarketOperator,
  resolveMarket,
  updateMarket,
  type ActionResult,
} from "@/lib/server/market-service";
import { ensureWeeklyAllowance } from "@/lib/server/allowance-service";
import {
  betSchema,
  cancelMarketSchema,
  collectFieldErrors,
  marketFormSchema,
  resolveMarketSchema,
} from "@/lib/validation";

export type MarketFormState = ActionResult & {
  fieldErrors?: Record<string, string>;
};

function invalidateAppData() {
  revalidatePath("/dashboard");
  revalidatePath("/portfolio");
  revalidatePath("/leaderboard");
  revalidatePath("/account");
  revalidatePath("/activity");
  revalidatePath("/admin");
  revalidatePath("/markets", "layout");
  revalidatePath("/l", "layout");
}

/** Outcome editor rows arrive as parallel outcomeLabel/outcomeColor fields. */
function readOutcomeFields(formData: FormData) {
  const labels = formData.getAll("outcomeLabel").map(String);
  const colors = formData.getAll("outcomeColor").map(String);
  const emojis = formData.getAll("outcomeEmoji").map(String);
  return labels.map((label, index) => ({
    label,
    color: colors[index] ?? "",
    emoji: emojis[index] || undefined,
  }));
}

function parseMarketForm(formData: FormData) {
  return marketFormSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    category: formData.get("category"),
    closeTime: formData.get("closeTime"),
    resolveTime: formData.get("resolveTime"),
    resolutionSource: formData.get("resolutionSource"),
    outcomes: readOutcomeFields(formData),
    maxStakePerUser: formData.get("maxStakePerUser") || undefined,
    rakeBps: formData.get("rakeBps") || undefined,
  });
}

export async function createMarketAction(_: MarketFormState, formData: FormData): Promise<MarketFormState> {
  // custom-league markets are opened by the league's owner/mods; without a
  // leagueId this is the Global League and stays app-admin-only
  const leagueId = String(formData.get("leagueId") ?? "") || undefined;
  const session = leagueId ? await requireSession() : await requireAdminSession();
  if (leagueId) {
    try {
      await requireLeagueRole(leagueId, session.user.id, [LeagueRole.OWNER, LeagueRole.MOD]);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Not allowed." };
    }
  }

  const parsed = parseMarketForm(formData);

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  try {
    await createMarket({
      leagueId,
      actorId: session.user.id,
      fields: {
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        closeTime: new Date(parsed.data.closeTime),
        resolveTime: new Date(parsed.data.resolveTime),
        resolutionSource: parsed.data.resolutionSource,
      },
      outcomes: parsed.data.outcomes,
      maxStakePerUser: parsed.data.maxStakePerUser,
      rakeBps: parsed.data.rakeBps,
      openNow: formData.get("openNow") === "true",
    });
    invalidateAppData();
    return { success: "Market created." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create market." };
  }
}

export async function updateMarketAction(_: MarketFormState, formData: FormData): Promise<MarketFormState> {
  const session = await requireSession();
  const marketId = String(formData.get("marketId") ?? "");
  const parsed = parseMarketForm(formData);

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  try {
    await requireMarketOperator(marketId, session.user.id);
    await updateMarket(marketId, session.user.id, {
      title: parsed.data.title,
      description: parsed.data.description,
      category: parsed.data.category,
      closeTime: new Date(parsed.data.closeTime),
      resolveTime: new Date(parsed.data.resolveTime),
      resolutionSource: parsed.data.resolutionSource,
      outcomes: parsed.data.outcomes,
      maxStakePerUser: parsed.data.maxStakePerUser,
      rakeBps: parsed.data.rakeBps,
    });
    invalidateAppData();
    revalidatePath(`/admin/markets/${marketId}`);
    return { success: "Market updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update market." };
  }
}

export async function marketStatusAction(formData: FormData) {
  const session = await requireSession();
  const marketId = String(formData.get("marketId") ?? "");
  const action = String(formData.get("action") ?? "");

  if (!marketId) {
    return;
  }

  await requireMarketOperator(marketId, session.user.id);

  if (action === "open") {
    await openMarket(marketId, session.user.id);
  }

  if (action === "close") {
    const rawCutoff = String(formData.get("effectiveCloseAt") ?? "").trim();
    const cutoff = rawCutoff ? new Date(rawCutoff) : undefined;
    if (cutoff && Number.isNaN(cutoff.getTime())) {
      return;
    }
    await closeMarket(marketId, session.user.id, cutoff);
  }

  invalidateAppData();
  revalidatePath(`/admin/markets/${marketId}`);
}

export async function resolveMarketAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = resolveMarketSchema.safeParse({
    marketId: formData.get("marketId"),
    winningOutcomeId: formData.get("winningOutcomeId"),
    resolutionSource: formData.get("resolutionSource"),
    notes: formData.get("notes") || undefined,
    effectiveCloseAt: formData.get("effectiveCloseAt") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Resolution details are invalid." };
  }

  try {
    await requireMarketOperator(parsed.data.marketId, session.user.id);
    await resolveMarket(
      parsed.data.marketId,
      session.user.id,
      parsed.data.winningOutcomeId,
      parsed.data.resolutionSource,
      parsed.data.notes,
      parsed.data.effectiveCloseAt ? new Date(parsed.data.effectiveCloseAt) : undefined,
    );
    invalidateAppData();
    revalidatePath(`/admin/markets/${parsed.data.marketId}`);
    return { success: "Market resolved and paid out." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to resolve market." };
  }
}

export async function cancelMarketAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = cancelMarketSchema.safeParse({
    marketId: formData.get("marketId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: "A cancellation reason is required." };
  }

  try {
    await requireMarketOperator(parsed.data.marketId, session.user.id);
    await cancelMarket(parsed.data.marketId, session.user.id, parsed.data.reason);
    invalidateAppData();
    revalidatePath(`/admin/markets/${parsed.data.marketId}`);
    return { success: "Market canceled and stakes refunded." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to cancel market." };
  }
}

export type PlaceBetActionResult = ActionResult & {
  pools?: Array<{ outcomeId: string; pool: number }>;
  stakeTotal?: number;
};

export async function placeBetAction(
  _: PlaceBetActionResult,
  formData: FormData,
): Promise<PlaceBetActionResult> {
  const session = await requireSession();
  const parsed = betSchema.safeParse({
    marketId: formData.get("marketId"),
    outcomeId: formData.get("outcomeId"),
    amount: formData.get("amount"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Bet input is invalid." };
  }

  const outcomeLabel = String(formData.get("outcomeLabel") ?? "your pick");

  try {
    const result = await placeBet({
      userId: session.user.id,
      marketId: parsed.data.marketId,
      outcomeId: parsed.data.outcomeId,
      amount: parsed.data.amount,
    });
    invalidateAppData();
    revalidatePath(`/markets/${parsed.data.marketId}`);
    return {
      success: `You're in — ${parsed.data.amount} points on ${outcomeLabel}.`,
      pools: result.pools,
      stakeTotal: result.stakeTotal,
    };
  } catch (error) {
    await recordBetFailure(session.user.id, parsed.data.marketId, error);
    return { error: error instanceof Error ? error.message : "Bet failed." };
  }
}

export async function refreshAllowanceAction() {
  const session = await requireSession();
  await ensureWeeklyAllowance(session.user.id);
  revalidatePath("/dashboard");
  revalidatePath("/account");
}
