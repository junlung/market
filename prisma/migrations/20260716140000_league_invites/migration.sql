-- League invites: a personal invitation into a custom league, accepted or
-- declined by the invitee (never a direct add). LeagueInviteStatus is a
-- brand-new enum, so its values are safe to reference in this migration's
-- partial index (the add-then-use split only applies to ALTER TYPE ... ADD VALUE).

-- CreateEnum
CREATE TYPE "LeagueInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "LeagueInvite" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT,
    "status" "LeagueInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "LeagueInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueInvite_userId_status_idx" ON "LeagueInvite"("userId", "status");
CREATE INDEX "LeagueInvite_leagueId_status_idx" ON "LeagueInvite"("leagueId", "status");

-- AddForeignKey
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique (Prisma can't express it — mirrored in
-- prisma/partial-indexes.sql, keep in sync):
-- at most one pending invite per invitee per league; declined rows are kept,
-- so re-inviting after a decline just creates a fresh PENDING row
CREATE UNIQUE INDEX "LeagueInvite_pending_key" ON "LeagueInvite"("leagueId", "userId") WHERE "status" = 'PENDING';
