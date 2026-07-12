-- Social features phase 2a (docs/social-features-plan.md): League becomes a
-- first-class entity and today's global app becomes the Global League.
-- Creates League/LeagueMembership/Season, inserts the one global league,
-- enrolls every existing user, and backfills leagueId onto Market and
-- LedgerEntry before constraining them NOT NULL.

-- CreateEnum
CREATE TYPE "LeagueJoinPolicy" AS ENUM ('INVITE_CODE', 'APPROVAL');

-- CreateEnum
CREATE TYPE "LeagueBalancePolicy" AS ENUM ('PERSISTENT', 'FRESH_PER_SEASON');

-- CreateEnum
CREATE TYPE "LeagueRole" AS ENUM ('OWNER', 'MOD', 'MEMBER');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'FINALIZED');

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "joinPolicy" "LeagueJoinPolicy" NOT NULL DEFAULT 'INVITE_CODE',
    "balancePolicy" "LeagueBalancePolicy" NOT NULL DEFAULT 'FRESH_PER_SEASON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LeagueRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SeasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "finalizedAt" TIMESTAMP(3),
    "standings" JSONB,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "League_slug_key" ON "League"("slug");

-- Exactly one global league — a partial unique index Prisma can't express.
CREATE UNIQUE INDEX "League_isGlobal_key" ON "League"("isGlobal") WHERE "isGlobal";

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_leagueId_userId_key" ON "LeagueMembership"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "LeagueMembership_userId_idx" ON "LeagueMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_leagueId_index_key" ON "Season"("leagueId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Season_leagueId_startsAt_key" ON "Season"("leagueId", "startsAt");

-- CreateIndex
CREATE INDEX "Season_leagueId_status_idx" ON "Season"("leagueId", "status");

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the Global League. The slug is the runtime lookup key
-- (src/lib/leagues.ts GLOBAL_LEAGUE_SLUG); fresh databases that skip
-- migrations (prisma db push in tests) get this row from ensureGlobalLeague()
-- instead, which upserts on the same slug.
INSERT INTO "League" ("id", "slug", "name", "description", "isGlobal", "joinPolicy", "balancePolicy")
VALUES (
    gen_random_uuid()::text,
    'global',
    'Global League',
    'Every member plays here. The leaderboard resets monthly; balances and markets carry over.',
    true,
    'APPROVAL',
    'PERSISTENT'
);

-- Every existing account joins the Global League (new accounts join at
-- approval time). Pending/rejected accounts are enrolled too — harmless, they
-- cannot log in, and it keeps "everyone belongs to the global league" simple.
INSERT INTO "LeagueMembership" ("id", "leagueId", "userId")
SELECT gen_random_uuid()::text, l."id", u."id"
FROM "User" u
CROSS JOIN "League" l
WHERE l."isGlobal";

-- AlterTable: Market.leagueId is added nullable, backfilled to the Global
-- League, then constrained — existing rows predate leagues.
ALTER TABLE "Market" ADD COLUMN "leagueId" TEXT;

UPDATE "Market" SET "leagueId" = (SELECT "id" FROM "League" WHERE "isGlobal");

ALTER TABLE "Market" ALTER COLUMN "leagueId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Market_leagueId_status_idx" ON "Market"("leagueId", "status");

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: same expand → backfill → constrain for the ledger.
ALTER TABLE "LedgerEntry" ADD COLUMN "leagueId" TEXT;

UPDATE "LedgerEntry" SET "leagueId" = (SELECT "id" FROM "League" WHERE "isGlobal");

ALTER TABLE "LedgerEntry" ALTER COLUMN "leagueId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "LedgerEntry_leagueId_userId_idx" ON "LedgerEntry"("leagueId", "userId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
