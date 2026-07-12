-- Phase 2b, step 1 of 2: the SEASON_STACK ledger type gets its own migration
-- because a value added to an enum cannot be referenced in the same
-- transaction (the next migration's partial unique index uses it).
ALTER TYPE "LedgerEntryType" ADD VALUE 'SEASON_STACK';
