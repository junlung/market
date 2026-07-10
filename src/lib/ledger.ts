import { LedgerEntryType } from "@prisma/client";
import { assertSafeInt } from "@/lib/parimutuel";

export type BalanceBreakdown = {
  grants: number;
  allowances: number;
  staked: number;
  payouts: number;
  refunds: number;
};

export function sumLedgerAmounts(entries: Array<{ amount: number }>) {
  const total = entries.reduce((sum, entry) => {
    if (!Number.isSafeInteger(entry.amount)) {
      throw new Error("Ledger amounts must be integers.");
    }
    return sum + entry.amount;
  }, 0);

  if (!Number.isSafeInteger(total)) {
    throw new Error("Ledger total overflowed the safe integer range.");
  }

  return total;
}

export function categorizeLedgerAmount(type: LedgerEntryType, amount: number): BalanceBreakdown {
  const empty: BalanceBreakdown = { grants: 0, allowances: 0, staked: 0, payouts: 0, refunds: 0 };

  switch (type) {
    case LedgerEntryType.INITIAL_GRANT:
      return { ...empty, grants: amount };
    case LedgerEntryType.WEEKLY_ALLOWANCE:
      return { ...empty, allowances: amount };
    case LedgerEntryType.BET_PLACED:
      return { ...empty, staked: Math.abs(amount) };
    case LedgerEntryType.MARKET_PAYOUT:
      return { ...empty, payouts: amount };
    case LedgerEntryType.MARKET_REFUND:
      return { ...empty, refunds: amount };
  }
}

export function buildBalanceBreakdown(entries: Array<{ type: LedgerEntryType; amount: number }>) {
  return entries.reduce<BalanceBreakdown>(
    (totals, entry) => {
      const contribution = categorizeLedgerAmount(entry.type, entry.amount);
      return {
        grants: totals.grants + contribution.grants,
        allowances: totals.allowances + contribution.allowances,
        staked: totals.staked + contribution.staked,
        payouts: totals.payouts + contribution.payouts,
        refunds: totals.refunds + contribution.refunds,
      };
    },
    { grants: 0, allowances: 0, staked: 0, payouts: 0, refunds: 0 },
  );
}

export function reconcileBalanceFromBreakdown(breakdown: BalanceBreakdown) {
  const balance =
    breakdown.grants + breakdown.allowances - breakdown.staked + breakdown.payouts + breakdown.refunds;
  assertSafeInt(Math.abs(balance), "Reconciled balance");
  return balance;
}
