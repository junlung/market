-- Effective close cutoff follow-up: refunds of bets voided by the cutoff get
-- their own ledger type so standings and P&L views can tell them apart from
-- cancel/nobody-won refunds. Enum values get their own migration (a value
-- added to an enum cannot be referenced in the same transaction); nothing in
-- SQL references it — the first writers are the settlement code paths.
ALTER TYPE "LedgerEntryType" ADD VALUE 'BET_VOID_REFUND';
