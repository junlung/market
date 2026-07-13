-- Phase 3 follow-up: a one-time gem starting allowance for every member
-- (granted by the launch backfill and at account approval). Step 1 of 2 —
-- a value added to an enum cannot be referenced in the same transaction,
-- so the partial unique that uses it lives in the next migration.
ALTER TYPE "GemLedgerEntryType" ADD VALUE 'STARTING_GRANT';
