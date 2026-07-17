-- Contract release (release 2 of the multi-outcome expand/contract migration):
-- drop the legacy binary-market columns that release 1 kept dual-written as a
-- rollback safety net. Nothing reads them; the Outcome-based model has been the
-- source of truth since release 1.

-- AlterTable
ALTER TABLE "Bet" DROP COLUMN "noPoolAfter",
DROP COLUMN "side",
DROP COLUMN "yesPoolAfter";

-- AlterTable
ALTER TABLE "Market" DROP COLUMN "finalOutcome",
DROP COLUMN "noPool",
DROP COLUMN "yesPool";

-- AlterTable
ALTER TABLE "MarketResolution" DROP COLUMN "noPoolFinal",
DROP COLUMN "outcome",
DROP COLUMN "yesPoolFinal";

-- AlterTable
ALTER TABLE "PoolStake" DROP COLUMN "noStake",
DROP COLUMN "yesStake";

-- DropEnum (after the columns that referenced them — Postgres can't shrink an
-- enum in place, so the whole types go)
DROP TYPE "BetSide";

-- DropEnum
DROP TYPE "MarketOutcome";
