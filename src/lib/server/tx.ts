import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 3;

function isSerializationFailure(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return true;
    }
    // two first-time bets on the same outcome can race the PoolStake upsert's
    // (userId, marketId, outcomeId) unique — a retry takes the update branch
    if (error.code === "P2002") {
      return true;
    }
  }

  // belt-and-braces: raw Postgres serialization/deadlock SQLSTATEs
  const message = error instanceof Error ? error.message : "";
  return message.includes("40001") || message.includes("40P01");
}

function jitteredDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 75 * attempt));
}

/**
 * Runs `fn` in a SERIALIZABLE transaction, retrying on serialization failures.
 *
 * Balance checks read "SUM of ledger rows" — a predicate that row locks cannot
 * protect against concurrent inserts. Postgres SSI aborts one of two racing
 * transactions instead; retrying re-runs the checks against committed state.
 */
export async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      });
    } catch (error) {
      lastError = error;

      if (!isSerializationFailure(error) || attempt === MAX_ATTEMPTS) {
        if (isSerializationFailure(error)) {
          throw new Error("The app is busy — please try that again.");
        }
        throw error;
      }

      await jitteredDelay(attempt);
    }
  }

  throw lastError;
}
