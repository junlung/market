-- Step 2 of 2: one gem starting grant per user, ever — idempotent across
-- the launch backfill, approval, and reject/approve cycles. Mirrored in
-- prisma/partial-indexes.sql (keep in sync).
CREATE UNIQUE INDEX "GemLedgerEntry_startingGrant_key" ON "GemLedgerEntry"("userId") WHERE "type" = 'STARTING_GRANT';
