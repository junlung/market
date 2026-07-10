import { LedgerEntryType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildBalanceBreakdown,
  categorizeLedgerAmount,
  reconcileBalanceFromBreakdown,
  sumLedgerAmounts,
} from "@/lib/ledger";

describe("sumLedgerAmounts", () => {
  it("sums signed integer amounts", () => {
    expect(
      sumLedgerAmounts([{ amount: 500 }, { amount: -120 }, { amount: 100 }, { amount: 35 }]),
    ).toBe(515);
  });

  it("returns 0 for an empty ledger", () => {
    expect(sumLedgerAmounts([])).toBe(0);
  });

  it("rejects fractional amounts", () => {
    expect(() => sumLedgerAmounts([{ amount: 1.5 }])).toThrow();
  });
});

describe("categorizeLedgerAmount", () => {
  it("routes each type to its bucket", () => {
    expect(categorizeLedgerAmount(LedgerEntryType.INITIAL_GRANT, 500).grants).toBe(500);
    expect(categorizeLedgerAmount(LedgerEntryType.WEEKLY_ALLOWANCE, 100).allowances).toBe(100);
    expect(categorizeLedgerAmount(LedgerEntryType.BET_PLACED, -50).staked).toBe(50);
    expect(categorizeLedgerAmount(LedgerEntryType.MARKET_PAYOUT, 385).payouts).toBe(385);
    expect(categorizeLedgerAmount(LedgerEntryType.MARKET_REFUND, 75).refunds).toBe(75);
  });
});

describe("buildBalanceBreakdown + reconcileBalanceFromBreakdown", () => {
  it("reconciles a mixed ledger to the plain sum", () => {
    const entries = [
      { type: LedgerEntryType.INITIAL_GRANT, amount: 500 },
      { type: LedgerEntryType.WEEKLY_ALLOWANCE, amount: 100 },
      { type: LedgerEntryType.BET_PLACED, amount: -150 },
      { type: LedgerEntryType.BET_PLACED, amount: -50 },
      { type: LedgerEntryType.MARKET_PAYOUT, amount: 290 },
      { type: LedgerEntryType.MARKET_REFUND, amount: 50 },
    ];

    const breakdown = buildBalanceBreakdown(entries);
    expect(breakdown).toEqual({ grants: 500, allowances: 100, staked: 200, payouts: 290, refunds: 50 });
    expect(reconcileBalanceFromBreakdown(breakdown)).toBe(sumLedgerAmounts(entries));
    expect(reconcileBalanceFromBreakdown(breakdown)).toBe(740);
  });
});
