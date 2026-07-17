/**
 * Pure settlement math for CLOSEST_GUESS markets: every entrant anted the
 * same amount, the pot is entrants × ante, and the closest guesses to the
 * actual value take it — 60/25/15 across the podium, no rake, no gems.
 *
 * Ranking is competition-style on distance: guesses tied on distance share a
 * rank, consume that many podium positions, and split those positions'
 * shares equally (floor; remainders burn as dust). With fewer entrants than
 * podium positions, the unclaimed positions' shares roll to 1st. Conservation:
 * totalIn === totalOut + dust — re-checked at runtime like every settlement.
 */
import { assertSafeInt } from "@/lib/parimutuel";

/** Podium shares in percent — 1st, 2nd, 3rd. */
export const CLOSEST_GUESS_SPLITS = [60, 25, 15] as const;

export type GuessInput = {
  userId: string;
  /** the guessed instant, as epoch ms (pure — no Date objects) */
  valueMs: number;
};

export type GuessPayout = {
  userId: string;
  /** competition rank by distance: tied guesses share the same rank */
  rank: number;
  amount: number;
};

export type GuessSettlementResult = {
  payouts: GuessPayout[];
  /** every entrant with their final rank, podium or not (for freezing) */
  ranks: Array<{ userId: string; rank: number }>;
  totalIn: number;
  totalOut: number;
  dust: number;
};

export function computeGuessSettlement(
  guesses: GuessInput[],
  actualMs: number,
  ante: number,
): GuessSettlementResult {
  assertSafeInt(ante, "Ante");
  if (ante < 1) {
    throw new Error("The ante must be at least 1 point.");
  }
  if (!Number.isFinite(actualMs)) {
    throw new Error("The actual value must be a valid instant.");
  }
  const userIds = new Set(guesses.map((guess) => guess.userId));
  if (userIds.size !== guesses.length) {
    throw new Error("Each entrant holds exactly one guess.");
  }

  if (guesses.length === 0) {
    return { payouts: [], ranks: [], totalIn: 0, totalOut: 0, dust: 0 };
  }

  const totalIn = guesses.length * ante;
  assertSafeInt(totalIn, "Pot");

  // competition ranking: sort by distance, group ties, ranks consume positions
  const byDistance = [...guesses]
    .map((guess) => ({ userId: guess.userId, distance: Math.abs(guess.valueMs - actualMs) }))
    .sort((a, b) => a.distance - b.distance || a.userId.localeCompare(b.userId));

  const groups: Array<{ userIds: string[]; rank: number }> = [];
  let position = 0;
  for (const entry of byDistance) {
    const last = groups[groups.length - 1];
    const lastDistance = last
      ? Math.abs(guesses.find((guess) => guess.userId === last.userIds[0])!.valueMs - actualMs)
      : null;
    if (last && entry.distance === lastDistance) {
      last.userIds.push(entry.userId);
    } else {
      groups.push({ userIds: [entry.userId], rank: position + 1 });
    }
    position += 1;
  }

  // integer podium shares; the percent-rounding remainder rolls to 1st, and so
  // do the shares of podium positions no entrant claims
  const claimedPositions = Math.min(CLOSEST_GUESS_SPLITS.length, guesses.length);
  const positionShare = CLOSEST_GUESS_SPLITS.map((split, index) =>
    index < claimedPositions ? Math.floor((totalIn * split) / 100) : 0,
  );
  const unclaimed = CLOSEST_GUESS_SPLITS.slice(claimedPositions).reduce(
    (sum, split) => sum + Math.floor((totalIn * split) / 100),
    0,
  );
  positionShare[0] += totalIn - positionShare.reduce((sum, share) => sum + share, 0) - unclaimed;
  positionShare[0] += unclaimed;

  const payouts: GuessPayout[] = [];
  const ranks: Array<{ userId: string; rank: number }> = [];
  for (const group of groups) {
    for (const userId of group.userIds) {
      ranks.push({ userId, rank: group.rank });
    }
    const firstPosition = group.rank - 1;
    if (firstPosition >= CLOSEST_GUESS_SPLITS.length) {
      continue;
    }
    const lastPosition = Math.min(
      firstPosition + group.userIds.length - 1,
      CLOSEST_GUESS_SPLITS.length - 1,
    );
    let groupShare = 0;
    for (let index = firstPosition; index <= lastPosition; index += 1) {
      groupShare += positionShare[index];
    }
    const perMember = Math.floor(groupShare / group.userIds.length);
    if (perMember > 0) {
      for (const userId of group.userIds) {
        payouts.push({ userId, rank: group.rank, amount: perMember });
      }
    }
  }

  const totalOut = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  const dust = totalIn - totalOut;
  if (dust < 0 || totalIn !== totalOut + dust) {
    throw new Error("Closest-guess settlement failed conservation check.");
  }

  return { payouts, ranks, totalIn, totalOut, dust };
}
