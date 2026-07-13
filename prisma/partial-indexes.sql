-- Partial unique indexes Prisma's schema language can't express. Real
-- deployments get these from migrations; `prisma db push` environments
-- (integration tests) apply this file right after the push. Keep in sync
-- with the migrations that created them.

-- exactly one global league (20260712120000_leagues_seasons)
CREATE UNIQUE INDEX IF NOT EXISTS "League_isGlobal_key" ON "League"("isGlobal") WHERE "isGlobal";

-- one fresh stack per user per season (20260712130100_league_settings_seasons)
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_seasonStack_key" ON "LedgerEntry"("userId", "seasonId") WHERE "type" = 'SEASON_STACK';

-- one rake conversion per user per market (20260712150000_gems_cosmetics)
CREATE UNIQUE INDEX IF NOT EXISTS "GemLedgerEntry_rakeConversion_key" ON "GemLedgerEntry"("userId", "marketId") WHERE "type" = 'RAKE_CONVERSION';

-- one placement grant per user per season (20260712150000_gems_cosmetics)
CREATE UNIQUE INDEX IF NOT EXISTS "GemLedgerEntry_seasonPlacement_key" ON "GemLedgerEntry"("userId", "seasonId") WHERE "type" = 'SEASON_PLACEMENT';

-- one store purchase per user per item (20260712150000_gems_cosmetics)
CREATE UNIQUE INDEX IF NOT EXISTS "UserItem_purchase_key" ON "UserItem"("userId", "itemId") WHERE "source" = 'PURCHASE';

-- at most one equipped item per slot (20260712150000_gems_cosmetics)
CREATE UNIQUE INDEX IF NOT EXISTS "UserItem_equipped_slot_key" ON "UserItem"("userId", "equippedSlot") WHERE "equippedSlot" IS NOT NULL;

-- one gem starting grant per user, ever (20260712170100_gem_starting_grant_index)
CREATE UNIQUE INDEX IF NOT EXISTS "GemLedgerEntry_startingGrant_key" ON "GemLedgerEntry"("userId") WHERE "type" = 'STARTING_GRANT';
