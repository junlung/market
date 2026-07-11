-- Multi-outcome markets: EXPAND release (1 of 2).
--
-- Adds the Outcome table and generalized columns, explodes binary data into
-- per-outcome rows, and keeps every legacy column (yesPool/noPool, side, old
-- bet snapshots, finalOutcome, yes/noPoolFinal) nullable and dual-written so
-- the previous deploy keeps working against this schema while the new build
-- rolls out. The CONTRACT release drops the legacy columns and enums.
--
-- Runs in one transaction (prisma migrate deploy). Every backfill is followed
-- by DO $$ asserts that abort the whole migration on any mismatch.

-- ---------------------------------------------------------------------------
-- 1. Outcome table
-- ---------------------------------------------------------------------------

CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "pool" INTEGER NOT NULL DEFAULT 0,
    "poolFinal" INTEGER,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Outcome_marketId_idx" ON "Outcome"("marketId");
CREATE UNIQUE INDEX "Outcome_marketId_sortOrder_key" ON "Outcome"("marketId", "sortOrder");

ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_marketId_fkey"
  FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing market is binary: Yes = sortOrder 0 (green), No = sortOrder 1 (red).
-- Ids are SQL-generated (not cuids) — application id validation is shape-loose.
INSERT INTO "Outcome" ("id", "marketId", "label", "color", "pool", "sortOrder")
SELECT gen_random_uuid()::text, m."id", 'Yes', 'green', m."yesPool", 0 FROM "Market" m;

INSERT INTO "Outcome" ("id", "marketId", "label", "color", "pool", "sortOrder")
SELECT gen_random_uuid()::text, m."id", 'No', 'red', m."noPool", 1 FROM "Market" m;

-- Freeze settled pools from the resolution audit rows.
UPDATE "Outcome" o
SET "poolFinal" = CASE o."sortOrder" WHEN 0 THEN r."yesPoolFinal" ELSE r."noPoolFinal" END
FROM "MarketResolution" r
WHERE r."marketId" = o."marketId";

DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "Market" m
  WHERE (SELECT count(*) FROM "Outcome" o WHERE o."marketId" = m."id") <> 2;
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % markets missing their 2 outcome rows', bad;
  END IF;

  SELECT count(*) INTO bad FROM "Market" m
  WHERE m."yesPool" + m."noPool" <>
    (SELECT COALESCE(sum(o."pool"), -1) FROM "Outcome" o WHERE o."marketId" = m."id");
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % markets where sum(Outcome.pool) != yesPool + noPool', bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Bet: generalized snapshots (outcomeId + outcomePoolAfter/totalPoolAfter)
-- ---------------------------------------------------------------------------

ALTER TABLE "Bet"
  ADD COLUMN "outcomeId" TEXT,
  ADD COLUMN "outcomePoolAfter" INTEGER,
  ADD COLUMN "totalPoolAfter" INTEGER,
  ALTER COLUMN "side" DROP NOT NULL,
  ALTER COLUMN "yesPoolAfter" DROP NOT NULL,
  ALTER COLUMN "noPoolAfter" DROP NOT NULL;

UPDATE "Bet" b
SET "outcomeId" = o."id",
    "outcomePoolAfter" = CASE b."side" WHEN 'YES' THEN b."yesPoolAfter" ELSE b."noPoolAfter" END,
    "totalPoolAfter" = b."yesPoolAfter" + b."noPoolAfter"
FROM "Outcome" o
WHERE o."marketId" = b."marketId"
  AND o."sortOrder" = CASE b."side" WHEN 'YES' THEN 0 ELSE 1 END;

DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "Bet"
  WHERE "outcomeId" IS NULL OR "outcomePoolAfter" IS NULL OR "totalPoolAfter" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % bets not backfilled', bad;
  END IF;
END $$;

ALTER TABLE "Bet"
  ALTER COLUMN "outcomeId" SET NOT NULL,
  ALTER COLUMN "outcomePoolAfter" SET NOT NULL,
  ALTER COLUMN "totalPoolAfter" SET NOT NULL;

ALTER TABLE "Bet" ADD CONSTRAINT "Bet_outcomeId_fkey"
  FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. PoolStake: explode (userId, marketId, yes/no) into (userId, marketId, outcomeId)
-- ---------------------------------------------------------------------------

ALTER TABLE "PoolStake"
  ADD COLUMN "outcomeId" TEXT,
  ADD COLUMN "amount" INTEGER NOT NULL DEFAULT 0;

-- The old one-row-per-user-per-market unique must go before the explosion
-- inserts a second row for users straddling both sides.
DROP INDEX "PoolStake_userId_marketId_key";

-- Straddling rows (both sides > 0) spawn a new row carrying the NO side;
-- updatedAt is set explicitly (it is Prisma-managed, plain SQL won't touch it).
INSERT INTO "PoolStake" ("id", "userId", "marketId", "outcomeId", "amount", "yesStake", "noStake", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, ps."userId", ps."marketId", o."id", ps."noStake", 0, ps."noStake", ps."createdAt", ps."updatedAt"
FROM "PoolStake" ps
JOIN "Outcome" o ON o."marketId" = ps."marketId" AND o."sortOrder" = 1
WHERE ps."yesStake" > 0 AND ps."noStake" > 0 AND ps."outcomeId" IS NULL;

-- Reuse the original row for its remaining side; straddling rows hand their
-- NO stake to the row inserted above (legacy noStake zeroed with it).
UPDATE "PoolStake" ps
SET "outcomeId" = o."id",
    "amount" = CASE WHEN ps."yesStake" > 0 THEN ps."yesStake" ELSE ps."noStake" END,
    "noStake" = CASE WHEN ps."yesStake" > 0 THEN 0 ELSE ps."noStake" END
FROM "Outcome" o
WHERE ps."outcomeId" IS NULL
  AND (ps."yesStake" > 0 OR ps."noStake" > 0)
  AND o."marketId" = ps."marketId"
  AND o."sortOrder" = CASE WHEN ps."yesStake" > 0 THEN 0 ELSE 1 END;

-- Zero rows carry no stake; the new model keeps rows only where amount > 0.
DELETE FROM "PoolStake" WHERE "outcomeId" IS NULL AND "yesStake" = 0 AND "noStake" = 0;

DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "PoolStake" WHERE "outcomeId" IS NULL OR "amount" <= 0;
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % pool stakes not exploded', bad;
  END IF;

  -- the upgraded per-outcome cross-check: stake sums must equal outcome pools
  SELECT count(*) INTO bad FROM "Outcome" o
  WHERE o."pool" <> (SELECT COALESCE(sum(ps."amount"), 0) FROM "PoolStake" ps WHERE ps."outcomeId" = o."id");
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % outcomes where sum(PoolStake.amount) != Outcome.pool', bad;
  END IF;

  -- legacy dual-write consistency on the exploded rows
  SELECT count(*) INTO bad FROM "PoolStake" WHERE "amount" <> "yesStake" + "noStake";
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % pool stakes where amount != yesStake + noStake', bad;
  END IF;
END $$;

CREATE UNIQUE INDEX "PoolStake_userId_marketId_outcomeId_key" ON "PoolStake"("userId", "marketId", "outcomeId");

ALTER TABLE "PoolStake" ALTER COLUMN "outcomeId" SET NOT NULL;
ALTER TABLE "PoolStake" ADD CONSTRAINT "PoolStake_outcomeId_fkey"
  FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Market.winningOutcomeId + MarketResolution.winningOutcomeId
-- ---------------------------------------------------------------------------

ALTER TABLE "Market" ADD COLUMN "winningOutcomeId" TEXT;

UPDATE "Market" m
SET "winningOutcomeId" = o."id"
FROM "Outcome" o
WHERE m."status" = 'RESOLVED'
  AND m."finalOutcome" IN ('YES', 'NO')
  AND o."marketId" = m."id"
  AND o."sortOrder" = CASE m."finalOutcome" WHEN 'YES' THEN 0 ELSE 1 END;

ALTER TABLE "MarketResolution"
  ADD COLUMN "winningOutcomeId" TEXT,
  ALTER COLUMN "outcome" DROP NOT NULL,
  ALTER COLUMN "yesPoolFinal" DROP NOT NULL,
  ALTER COLUMN "noPoolFinal" DROP NOT NULL;

UPDATE "MarketResolution" r
SET "winningOutcomeId" = o."id"
FROM "Outcome" o
WHERE r."outcome" IN ('YES', 'NO')
  AND o."marketId" = r."marketId"
  AND o."sortOrder" = CASE r."outcome" WHEN 'YES' THEN 0 ELSE 1 END;

DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "Market"
  WHERE "status" = 'RESOLVED' AND "winningOutcomeId" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % resolved markets without winningOutcomeId', bad;
  END IF;

  SELECT count(*) INTO bad FROM "MarketResolution"
  WHERE "outcome" IN ('YES', 'NO') AND "winningOutcomeId" IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % resolutions without winningOutcomeId', bad;
  END IF;

  -- typed-int conservation audit survives the migration: frozen outcome pools
  -- account for every point paid out or burned (holds for cancels too, where
  -- winningPool/losingPool are 0 by design)
  SELECT count(*) INTO bad FROM "MarketResolution" r
  WHERE r."totalPaidOut" + r."rakeAmount" + r."dustAmount" <>
    (SELECT COALESCE(sum(o."poolFinal"), -1) FROM "Outcome" o WHERE o."marketId" = r."marketId");
  IF bad > 0 THEN
    RAISE EXCEPTION 'multi_outcome_expand: % resolutions failing conservation against frozen pools', bad;
  END IF;
END $$;

ALTER TABLE "Market" ADD CONSTRAINT "Market_winningOutcomeId_fkey"
  FOREIGN KEY ("winningOutcomeId") REFERENCES "Outcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
