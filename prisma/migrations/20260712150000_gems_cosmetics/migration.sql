-- Phase 3 (docs/social-features-plan.md): the gems meta-currency and the
-- cosmetics equip/purchase groundwork. GemLedgerEntryType is a brand-new enum,
-- so its values are safe to reference in this migration's partial indexes
-- (the add-then-use split only applies to ALTER TYPE ... ADD VALUE).

-- CreateEnum
CREATE TYPE "GemLedgerEntryType" AS ENUM ('RAKE_CONVERSION', 'ACHIEVEMENT', 'SEASON_PLACEMENT', 'STORE_PURCHASE', 'ADMIN_ADJUST');

-- CreateTable
CREATE TABLE "GemLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "GemLedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "marketId" TEXT,
    "seasonId" TEXT,
    "achievementKey" TEXT,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GemLedgerEntry_userId_achievementKey_key" ON "GemLedgerEntry"("userId", "achievementKey");
CREATE INDEX "GemLedgerEntry_userId_createdAt_idx" ON "GemLedgerEntry"("userId", "createdAt");
CREATE INDEX "GemLedgerEntry_marketId_idx" ON "GemLedgerEntry"("marketId");

-- AddForeignKey
ALTER TABLE "GemLedgerEntry" ADD CONSTRAINT "GemLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GemLedgerEntry" ADD CONSTRAINT "GemLedgerEntry_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GemLedgerEntry" ADD CONSTRAINT "GemLedgerEntry_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GemLedgerEntry" ADD CONSTRAINT "GemLedgerEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: settlement audit symmetry — gems minted from this market's rake.
ALTER TABLE "MarketResolution" ADD COLUMN "gemsMinted" INTEGER NOT NULL DEFAULT 0;

-- Partial uniques (Prisma can't express these — mirrored in
-- prisma/partial-indexes.sql, keep in sync):
-- one rake conversion per user per market
CREATE UNIQUE INDEX "GemLedgerEntry_rakeConversion_key" ON "GemLedgerEntry"("userId", "marketId") WHERE "type" = 'RAKE_CONVERSION';
-- one placement grant per user per season
CREATE UNIQUE INDEX "GemLedgerEntry_seasonPlacement_key" ON "GemLedgerEntry"("userId", "seasonId") WHERE "type" = 'SEASON_PLACEMENT';
-- one store purchase per user per item (trophies legitimately repeat itemIds
-- across seasons, so this scopes to PURCHASE rows only)
CREATE UNIQUE INDEX "UserItem_purchase_key" ON "UserItem"("userId", "itemId") WHERE "source" = 'PURCHASE';
-- at most one equipped item per slot; doubles as the covering index for the
-- equipped-cosmetics batch query
CREATE UNIQUE INDEX "UserItem_equipped_slot_key" ON "UserItem"("userId", "equippedSlot") WHERE "equippedSlot" IS NOT NULL;
