export type PoolState = {
  yesPool: number;
  noPool: number;
};

export type StakeRow = {
  userId: string;
  yesStake: number;
  noStake: number;
};

export type PayoutRow = {
  userId: string;
  amount: number;
  kind: "PAYOUT" | "REFUND";
};

export type SettlementMode = "NORMAL" | "REFUND_ALL" | "EMPTY";

export type SettlementResult = {
  mode: SettlementMode;
  payouts: PayoutRow[];
  winningPool: number;
  losingPool: number;
  rake: number;
  dust: number;
  totalIn: number;
  totalOut: number;
};

export const RAKE_BPS_DENOMINATOR = 10_000;

export function assertSafeInt(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function assertRakeBps(rakeBps: number) {
  if (!Number.isSafeInteger(rakeBps) || rakeBps < 0 || rakeBps > RAKE_BPS_DENOMINATOR) {
    throw new Error(`Rake must be an integer between 0 and ${RAKE_BPS_DENOMINATOR} bps.`);
  }
}

export function getOdds(state: PoolState) {
  assertSafeInt(state.yesPool, "Yes pool");
  assertSafeInt(state.noPool, "No pool");

  const total = state.yesPool + state.noPool;

  if (total === 0) {
    return {
      yesProbability: 0.5,
      noProbability: 0.5,
      yesMultiplier: null,
      noMultiplier: null,
      total,
    };
  }

  return {
    yesProbability: state.yesPool / total,
    noProbability: state.noPool / total,
    // gross pre-rake multiplier, display only
    yesMultiplier: state.yesPool > 0 ? total / state.yesPool : null,
    noMultiplier: state.noPool > 0 ? total / state.noPool : null,
    total,
  };
}

export function computeRake(losingPool: number, rakeBps: number) {
  assertSafeInt(losingPool, "Losing pool");
  assertRakeBps(rakeBps);
  return Math.floor((losingPool * rakeBps) / RAKE_BPS_DENOMINATOR);
}

/**
 * Bet-slip preview: what a stake would pay if the market resolved for it
 * with the given final pools. `winningPool` must already include `stake`.
 */
export function estimatePayout(input: {
  stake: number;
  winningPool: number;
  losingPool: number;
  rakeBps: number;
}) {
  assertSafeInt(input.stake, "Stake");
  assertSafeInt(input.winningPool, "Winning pool");
  assertSafeInt(input.losingPool, "Losing pool");

  if (input.stake === 0 || input.winningPool === 0) {
    return 0;
  }

  if (input.stake > input.winningPool) {
    throw new Error("Stake cannot exceed the winning pool.");
  }

  const distributable = input.losingPool - computeRake(input.losingPool, input.rakeBps);
  return input.stake + Math.floor((input.stake * distributable) / input.winningPool);
}

function totalStake(row: StakeRow) {
  return row.yesStake + row.noStake;
}

function validateStakes(stakes: StakeRow[]) {
  for (const row of stakes) {
    assertSafeInt(row.yesStake, `Yes stake for ${row.userId}`);
    assertSafeInt(row.noStake, `No stake for ${row.userId}`);
  }
}

function refundAll(stakes: StakeRow[], totalIn: number): SettlementResult {
  const payouts = stakes
    .filter((row) => totalStake(row) > 0)
    .map((row) => ({ userId: row.userId, amount: totalStake(row), kind: "REFUND" as const }));

  return {
    mode: "REFUND_ALL",
    payouts,
    winningPool: 0,
    losingPool: 0,
    rake: 0,
    dust: 0,
    totalIn,
    totalOut: payouts.reduce((sum, row) => sum + row.amount, 0),
  };
}

/**
 * Deterministic parimutuel settlement.
 *
 * NORMAL: each winner receives stake + floor(stake * (L - rake) / W).
 *   Winners never receive less than their stake; rounding dust is burned.
 * W = 0 with money on the losing side: nobody won — refund everyone, no rake.
 * No stakes at all: EMPTY.
 *
 * Invariant (checkConservation): totalIn === totalOut + rake + dust.
 */
export function computeSettlement(
  stakes: StakeRow[],
  outcome: "YES" | "NO",
  rakeBps: number,
): SettlementResult {
  validateStakes(stakes);
  assertRakeBps(rakeBps);

  const sorted = [...stakes].sort((a, b) => a.userId.localeCompare(b.userId));
  const winningPool = sorted.reduce(
    (sum, row) => sum + (outcome === "YES" ? row.yesStake : row.noStake),
    0,
  );
  const losingPool = sorted.reduce(
    (sum, row) => sum + (outcome === "YES" ? row.noStake : row.yesStake),
    0,
  );
  const totalIn = winningPool + losingPool;

  if (totalIn === 0) {
    return {
      mode: "EMPTY",
      payouts: [],
      winningPool: 0,
      losingPool: 0,
      rake: 0,
      dust: 0,
      totalIn: 0,
      totalOut: 0,
    };
  }

  if (winningPool === 0) {
    return refundAll(sorted, totalIn);
  }

  const rake = computeRake(losingPool, rakeBps);
  const distributable = losingPool - rake;
  let distributed = 0;

  const payouts: PayoutRow[] = [];

  for (const row of sorted) {
    const stake = outcome === "YES" ? row.yesStake : row.noStake;
    if (stake === 0) {
      continue;
    }

    const share = Math.floor((stake * distributable) / winningPool);
    distributed += share;
    payouts.push({ userId: row.userId, amount: stake + share, kind: "PAYOUT" });
  }

  const dust = distributable - distributed;
  const totalOut = payouts.reduce((sum, row) => sum + row.amount, 0);

  const result: SettlementResult = {
    mode: "NORMAL",
    payouts,
    winningPool,
    losingPool,
    rake,
    dust,
    totalIn,
    totalOut,
  };

  if (!checkConservation(result)) {
    throw new Error("Settlement failed conservation check.");
  }

  return result;
}

export function computeCancelRefunds(stakes: StakeRow[]): SettlementResult {
  validateStakes(stakes);
  const sorted = [...stakes].sort((a, b) => a.userId.localeCompare(b.userId));
  const totalIn = sorted.reduce((sum, row) => sum + totalStake(row), 0);

  if (totalIn === 0) {
    return {
      mode: "EMPTY",
      payouts: [],
      winningPool: 0,
      losingPool: 0,
      rake: 0,
      dust: 0,
      totalIn: 0,
      totalOut: 0,
    };
  }

  return refundAll(sorted, totalIn);
}

export function checkConservation(result: SettlementResult) {
  return result.totalIn === result.totalOut + result.rake + result.dust;
}
