-- Phase 3 follow-up: members pick up to 3 achievements to highlight on their
-- profile (validated against earned achievements in the service layer).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "showcasedAchievements" TEXT[] DEFAULT ARRAY[]::TEXT[];
