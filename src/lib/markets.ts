import { MarketStatus } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { getOdds } from "@/lib/parimutuel";
import { graphemeCount, isValidOutcomeColor } from "@/lib/outcome-colors";

export const MIN_OUTCOMES = 2;
export const MAX_OUTCOMES = 6;

export type OutcomeDraft = {
  label: string;
  color: string;
  emoji?: string | null;
};

export function isMarketEditable(market: {
  status: MarketStatus;
  firstBetAt: Date | null;
}) {
  if (market.status === MarketStatus.PROPOSED || market.status === MarketStatus.DRAFT) {
    return true;
  }

  return market.status === MarketStatus.OPEN && market.firstBetAt === null;
}

export function isMarketBettable(market: { status: MarketStatus; closeTime: Date }) {
  return market.status === MarketStatus.OPEN && market.closeTime > new Date();
}

export function validateMarketSchedule(closeTime: Date, resolveTime: Date) {
  if (closeTime >= resolveTime) {
    throw new Error("Resolve time must be after close time.");
  }
}

export function validateOutcomeDrafts(outcomes: OutcomeDraft[]) {
  if (outcomes.length < MIN_OUTCOMES || outcomes.length > MAX_OUTCOMES) {
    throw new Error(`Markets need ${MIN_OUTCOMES}–${MAX_OUTCOMES} outcomes.`);
  }

  const seen = new Set<string>();
  for (const outcome of outcomes) {
    const label = outcome.label.trim();
    if (!label) {
      throw new Error("Every outcome needs a label.");
    }
    if (label.length > 40) {
      throw new Error("Outcome labels max out at 40 characters.");
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate outcome label: ${label}`);
    }
    seen.add(key);
    if (!isValidOutcomeColor(outcome.color)) {
      throw new Error(`Unknown outcome color: ${outcome.color}`);
    }
    if (outcome.emoji) {
      const emoji = outcome.emoji.trim();
      if (emoji.length > 64 || graphemeCount(emoji) > 2) {
        throw new Error("Outcome emoji is limited to one or two symbols.");
      }
    }
  }
}

export function validateMarketDraft(input: {
  title: string;
  description: string;
  category: string;
  resolutionSource: string;
  closeTime: Date;
  resolveTime: Date;
}) {
  if (!input.title.trim()) throw new Error("Title is required.");
  if (!input.description.trim()) throw new Error("Description is required.");
  if (!input.category.trim()) throw new Error("Category is required.");
  if (!input.resolutionSource.trim()) throw new Error("Resolution source is required.");

  validateMarketSchedule(input.closeTime, input.resolveTime);
}

export type OutcomeView = {
  id: string;
  label: string;
  color: string;
  emoji: string | null;
  sortOrder: number;
  pool: number;
  poolFinal: number | null;
  probability: number;
  multiplier: number | null;
};


/**
 * Enrich a market's outcome rows with implied probabilities (1/N when empty).
 * `leader` is the highest-probability outcome, ties broken by sortOrder.
 */
export function getMarketOdds(
  outcomes: Array<{
    id: string;
    label: string;
    color: string;
    emoji?: string | null;
    sortOrder: number;
    pool: number;
    poolFinal?: number | null;
  }>,
) {
  const sorted = [...outcomes].sort((a, b) => a.sortOrder - b.sortOrder);
  const odds = getOdds(sorted.map((outcome) => outcome.pool));

  const views: OutcomeView[] = sorted.map((outcome, index) => ({
    id: outcome.id,
    label: outcome.label,
    color: outcome.color,
    emoji: outcome.emoji ?? null,
    sortOrder: outcome.sortOrder,
    pool: outcome.pool,
    poolFinal: outcome.poolFinal ?? null,
    probability: odds.probabilities[index],
    multiplier: odds.multipliers[index],
  }));

  const leader = views.reduce((best, view) => (view.probability > best.probability ? view : best), views[0]);

  return { outcomes: views, leader, pot: odds.total };
}

export function getMarketStatusLabel(status: MarketStatus) {
  return status.toLowerCase();
}

export function getMarketCloseWarning(closeTime: Date) {
  const msUntilClose = closeTime.getTime() - Date.now();
  return msUntilClose > 0 && msUntilClose <= appConfig.closeWarningHours * 60 * 60 * 1000;
}
