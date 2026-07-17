-- Effective close cutoff: the moment betting should have stopped on event
-- markets closed manually after the fact. Bets after it are void — excluded
-- from settlement math and refunded. voidRefunded records the refunded total
-- in the settlement audit row.

-- AlterTable
ALTER TABLE "Market" ADD COLUMN "effectiveCloseAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MarketResolution" ADD COLUMN "voidRefunded" INTEGER NOT NULL DEFAULT 0;
