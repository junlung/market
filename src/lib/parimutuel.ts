/** A user's aggregate stake on one outcome. A user may hold several outcomes. */
export type OutcomeStake = {
  userId: string;
  outcomeId: string;
  amount: number;
};

export type PayoutRow = {
  userId: string;
  amount: number;
  kind: "PAYOUT" | "REFUND";
  // the user's stake on the winning outcome — the pro-rata basis for the
  // rake→gems conversion (Phase 3). Always 0 on REFUND rows.
  winningStake: number;
  // true on REFUND rows that return stakes voided by the effective close
  // cutoff (bets placed after the event). A user can hold a PAYOUT row and a
  // voided REFUND row in the same settlement.
  voided?: boolean;
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

/**
 * Implied odds for an N-outcome market. An empty market shows the uniform
 * 1/N prior; multipliers are gross pre-rake, display only.
 */
export function getOdds(pools: number[]) {
  if (pools.length < 2) {
    throw new Error("A market needs at least 2 outcome pools.");
  }
  pools.forEach((pool, index) => assertSafeInt(pool, `Pool ${index}`));

  const total = pools.reduce((sum, pool) => sum + pool, 0);

  if (total === 0) {
    return {
      probabilities: pools.map(() => 1 / pools.length),
      multipliers: pools.map(() => null as number | null),
      total,
    };
  }

  return {
    probabilities: pools.map((pool) => pool / total),
    multipliers: pools.map((pool) => (pool > 0 ? total / pool : null)),
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
 * with the given final pools. `winningPool` must already include `stake`;
 * `losingPool` is the sum of every other outcome's pool.
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

function validateStakes(stakes: OutcomeStake[]) {
  for (const row of stakes) {
    assertSafeInt(row.amount, `Stake for ${row.userId} on ${row.outcomeId}`);
  }
}

/** One row per user: total staked plus the slice on the winning outcome. */
function groupByUser(stakes: OutcomeStake[], winningOutcomeId: string | null) {
  const users = new Map<string, { total: number; winning: number }>();
  for (const row of stakes) {
    const entry = users.get(row.userId) ?? { total: 0, winning: 0 };
    entry.total += row.amount;
    if (row.outcomeId === winningOutcomeId) {
      entry.winning += row.amount;
    }
    users.set(row.userId, entry);
  }
  return [...users.entries()]
    .map(([userId, entry]) => ({ userId, ...entry }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

function refundAll(users: Array<{ userId: string; total: number }>, totalIn: number): SettlementResult {
  const payouts = users
    .filter((row) => row.total > 0)
    .map((row) => ({ userId: row.userId, amount: row.total, kind: "REFUND" as const, winningStake: 0 }));

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

const EMPTY_RESULT: SettlementResult = {
  mode: "EMPTY",
  payouts: [],
  winningPool: 0,
  losingPool: 0,
  rake: 0,
  dust: 0,
  totalIn: 0,
  totalOut: 0,
};

/**
 * Deterministic parimutuel settlement over N outcomes.
 *
 * Stakes are grouped per user first — a user can hold the winner *and*
 * losers, and gets exactly one payout row. W = winning outcome's pool,
 * L = everything else.
 *
 * NORMAL: each winner receives winning stake + floor(stake * (L - rake) / W).
 *   Winners never receive less than their winning stake; rounding dust is burned.
 * W = 0 with money elsewhere: nobody won — refund everyone, no rake.
 * No stakes at all: EMPTY.
 *
 * Invariant (checkConservation): totalIn === totalOut + rake + dust.
 */
export function computeSettlement(
  stakes: OutcomeStake[],
  winningOutcomeId: string,
  rakeBps: number,
): SettlementResult {
  validateStakes(stakes);
  assertRakeBps(rakeBps);

  const users = groupByUser(stakes, winningOutcomeId);
  const totalIn = users.reduce((sum, row) => sum + row.total, 0);
  const winningPool = users.reduce((sum, row) => sum + row.winning, 0);
  const losingPool = totalIn - winningPool;

  if (totalIn === 0) {
    return EMPTY_RESULT;
  }

  if (winningPool === 0) {
    return refundAll(users, totalIn);
  }

  const rake = computeRake(losingPool, rakeBps);
  const distributable = losingPool - rake;
  let distributed = 0;

  const payouts: PayoutRow[] = [];

  for (const row of users) {
    if (row.winning === 0) {
      continue;
    }

    const share = Math.floor((row.winning * distributable) / winningPool);
    distributed += share;
    payouts.push({ userId: row.userId, amount: row.winning + share, kind: "PAYOUT", winningStake: row.winning });
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

/**
 * Settlement with an effective-close carve-out: `voidStakes` is the portion
 * of each (user, outcome) stake placed after the cutoff. The valid remainder
 * settles normally — odds, rake, and gem conversion all compute from valid
 * stakes only — and every void portion comes back as a REFUND row flagged
 * `voided`. Conservation covers both parts: totalIn (all stakes) ===
 * totalOut (payouts + all refunds) + rake + dust.
 */
export function computeSettlementWithVoids(
  stakes: OutcomeStake[],
  voidStakes: OutcomeStake[],
  winningOutcomeId: string,
  rakeBps: number,
): SettlementResult {
  if (voidStakes.length === 0) {
    return computeSettlement(stakes, winningOutcomeId, rakeBps);
  }
  validateStakes(stakes);
  validateStakes(voidStakes);

  const stakeByKey = new Map<string, number>();
  for (const row of stakes) {
    const key = `${row.userId}\u0000${row.outcomeId}`;
    stakeByKey.set(key, (stakeByKey.get(key) ?? 0) + row.amount);
  }

  const voidByKey = new Map<string, number>();
  for (const row of voidStakes) {
    const key = `${row.userId}\u0000${row.outcomeId}`;
    voidByKey.set(key, (voidByKey.get(key) ?? 0) + row.amount);
  }
  for (const [key, amount] of voidByKey) {
    if (amount > (stakeByKey.get(key) ?? 0)) {
      throw new Error("A void carve-out exceeds the stake it voids.");
    }
  }

  // subtract each void portion once, walking rows in order (aggregate rows
  // are unique per user+outcome in practice, but stay correct regardless)
  const remainingVoid = new Map(voidByKey);
  const validStakes: OutcomeStake[] = [];
  for (const row of stakes) {
    const key = `${row.userId}\u0000${row.outcomeId}`;
    const voidHere = Math.min(remainingVoid.get(key) ?? 0, row.amount);
    if (voidHere > 0) {
      remainingVoid.set(key, (remainingVoid.get(key) ?? 0) - voidHere);
    }
    if (row.amount - voidHere > 0) {
      validStakes.push({ ...row, amount: row.amount - voidHere });
    }
  }

  const base = computeSettlement(validStakes, winningOutcomeId, rakeBps);

  const voidByUser = new Map<string, number>();
  for (const [key, amount] of voidByKey) {
    const userId = key.split("\u0000")[0];
    voidByUser.set(userId, (voidByUser.get(userId) ?? 0) + amount);
  }
  const voidRows: PayoutRow[] = [...voidByUser.entries()]
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([userId, amount]) => ({ userId, amount, kind: "REFUND", winningStake: 0, voided: true }));
  const voidTotal = voidRows.reduce((sum, row) => sum + row.amount, 0);

  const result: SettlementResult = {
    // money moved even when every valid stake is gone — that's a refund, not
    // an empty market
    mode: base.mode === "EMPTY" ? "REFUND_ALL" : base.mode,
    payouts: [...base.payouts, ...voidRows],
    winningPool: base.winningPool,
    losingPool: base.losingPool,
    rake: base.rake,
    dust: base.dust,
    totalIn: base.totalIn + voidTotal,
    totalOut: base.totalOut + voidTotal,
  };

  if (!checkConservation(result)) {
    throw new Error("Settlement failed conservation check.");
  }

  return result;
}

export function computeCancelRefunds(stakes: OutcomeStake[]): SettlementResult {
  validateStakes(stakes);
  const users = groupByUser(stakes, null);
  const totalIn = users.reduce((sum, row) => sum + row.total, 0);

  if (totalIn === 0) {
    return EMPTY_RESULT;
  }

  return refundAll(users, totalIn);
}

export function checkConservation(result: SettlementResult) {
  return result.totalIn === result.totalOut + result.rake + result.dust;
}
