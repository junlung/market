import { MarketOutcome, MarketStatus } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { getOdds } from "@/lib/parimutuel";

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

export function getMarketOdds(market: { yesPool: number; noPool: number }) {
  const odds = getOdds({ yesPool: market.yesPool, noPool: market.noPool });

  return {
    yesProbability: odds.yesProbability,
    noProbability: odds.noProbability,
    yesMultiplier: odds.yesMultiplier,
    noMultiplier: odds.noMultiplier,
    pot: odds.total,
  };
}

export function getMarketStatusLabel(status: MarketStatus) {
  return status.toLowerCase();
}

export function getOutcomeLabel(outcome: MarketOutcome | null) {
  return outcome ? outcome.toLowerCase() : "pending";
}

export function getMarketCloseWarning(closeTime: Date) {
  const msUntilClose = closeTime.getTime() - Date.now();
  return msUntilClose > 0 && msUntilClose <= appConfig.closeWarningHours * 60 * 60 * 1000;
}
