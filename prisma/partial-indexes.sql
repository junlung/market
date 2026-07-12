-- Partial unique indexes Prisma's schema language can't express. Real
-- deployments get these from migrations; `prisma db push` environments
-- (integration tests) apply this file right after the push. Keep in sync
-- with the migrations that created them.

-- exactly one global league (20260712120000_leagues_seasons)
CREATE UNIQUE INDEX IF NOT EXISTS "League_isGlobal_key" ON "League"("isGlobal") WHERE "isGlobal";

-- one fresh stack per user per season (20260712130100_league_settings_seasons)
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_seasonStack_key" ON "LedgerEntry"("userId", "seasonId") WHERE "type" = 'SEASON_STACK';
