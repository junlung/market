-- Closest-guess markets: a new market kind where every entrant antes the same
-- fixed amount and the nearest date guesses take the pot (60/25/15 across the
-- podium, no rake, no gems). A brand-new enum can be created and referenced in
-- one migration — only adding values to an existing enum needs the two-step.

-- CreateEnum
CREATE TYPE "MarketKind" AS ENUM ('PARIMUTUEL', 'CLOSEST_GUESS');

-- AlterTable
ALTER TABLE "Market" ADD COLUMN "kind" "MarketKind" NOT NULL DEFAULT 'PARIMUTUEL',
ADD COLUMN "anteAmount" INTEGER;

-- AlterTable
ALTER TABLE "MarketResolution" ADD COLUMN "actualValue" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Guess" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TIMESTAMP(3) NOT NULL,
    "finalRank" INTEGER,
    "payout" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guess_marketId_userId_key" ON "Guess"("marketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Guess_marketId_value_key" ON "Guess"("marketId", "value");

-- CreateIndex
CREATE INDEX "Guess_userId_createdAt_idx" ON "Guess"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Guess" ADD CONSTRAINT "Guess_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guess" ADD CONSTRAINT "Guess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
