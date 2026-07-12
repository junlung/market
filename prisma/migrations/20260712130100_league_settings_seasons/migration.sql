-- Phase 2b, step 2 of 2 (docs/social-features-plan.md): league economy
-- settings + rotating invite code, season scoping on markets and the ledger
-- for FRESH_PER_SEASON stacks, and the per-league allowance key.

-- AlterTable: league settings (2b kickoff decision #2) + invite code.
-- Defaults mirror appConfig; the global league's row is display-only.
ALTER TABLE "League" ADD COLUMN "inviteCode" TEXT,
ADD COLUMN "startingStack" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN "weeklyAllowance" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "defaultRakeBps" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN "defaultMaxStakePerUser" INTEGER NOT NULL DEFAULT 500;

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");

-- AlterTable: season scoping. Null everywhere today — the Global League is
-- PERSISTENT, so its rows never carry a seasonId.
ALTER TABLE "Market" ADD COLUMN "seasonId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "seasonId" TEXT;

-- CreateIndex
CREATE INDEX "Market_seasonId_status_idx" ON "Market"("seasonId", "status");

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The weekly allowance becomes per-league: one grant per user per league per
-- week. Existing rows are all Global League, so the widened key can't clash.
DROP INDEX "LedgerEntry_userId_allowanceWeek_key";
CREATE UNIQUE INDEX "LedgerEntry_userId_leagueId_allowanceWeek_key" ON "LedgerEntry"("userId", "leagueId", "allowanceWeek");

-- One starting stack per user per season — partial unique (Prisma can't
-- express it; same pattern as League_isGlobal_key). This is what makes
-- fresh-stack grants idempotent under concurrent joins/cron runs.
CREATE UNIQUE INDEX "LedgerEntry_seasonStack_key" ON "LedgerEntry"("userId", "seasonId") WHERE "type" = 'SEASON_STACK';
