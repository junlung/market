"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession, requireSession } from "@/lib/session";
import { placeBet, recordBetFailure } from "@/lib/server/bet-service";
import {
  cancelMarket,
  closeMarket,
  createMarket,
  openMarket,
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
  revalidatePath("/history");
  revalidatePath("/leaderboard");
  revalidatePath("/account");
  revalidatePath("/activity");
  revalidatePath("/admin");
  revalidatePath("/markets", "layout");
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
  const session = await requireAdminSession();
  const parsed = parseMarketForm(formData);

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  try {
    await createMarket({
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
  const session = await requireAdminSession();
  const marketId = String(formData.get("marketId") ?? "");
  const parsed = parseMarketForm(formData);

  if (!parsed.success) {
    return { fieldErrors: collectFieldErrors(parsed.error) };
  }

  try {
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
  const session = await requireAdminSession();
  const marketId = String(formData.get("marketId") ?? "");
  const action = String(formData.get("action") ?? "");

  if (!marketId) {
    return;
  }

  if (action === "open") {
    await openMarket(marketId, session.user.id);
  }

  if (action === "close") {
    await closeMarket(marketId, session.user.id);
  }

  invalidateAppData();
  revalidatePath(`/admin/markets/${marketId}`);
}

export async function resolveMarketAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireAdminSession();
  const parsed = resolveMarketSchema.safeParse({
    marketId: formData.get("marketId"),
    winningOutcomeId: formData.get("winningOutcomeId"),
    resolutionSource: formData.get("resolutionSource"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: "Resolution details are invalid." };
  }

  try {
    await resolveMarket(
      parsed.data.marketId,
      session.user.id,
      parsed.data.winningOutcomeId,
      parsed.data.resolutionSource,
      parsed.data.notes,
    );
    invalidateAppData();
    revalidatePath(`/admin/markets/${parsed.data.marketId}`);
    return { success: "Market resolved and paid out." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to resolve market." };
  }
}

export async function cancelMarketAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await requireAdminSession();
  const parsed = cancelMarketSchema.safeParse({
    marketId: formData.get("marketId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: "A cancellation reason is required." };
  }

  try {
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
