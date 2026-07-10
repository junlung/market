-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "AppLogEventType_new" AS ENUM ('ADMIN_ACTION', 'BET_FAILURE', 'PROPOSAL_ACTION', 'MEMBERSHIP_ACTION');
ALTER TABLE "AppLog" ALTER COLUMN "eventType" TYPE "AppLogEventType_new" USING ("eventType"::text::"AppLogEventType_new");
ALTER TYPE "AppLogEventType" RENAME TO "AppLogEventType_old";
ALTER TYPE "AppLogEventType_new" RENAME TO "AppLogEventType";
DROP TYPE "public"."AppLogEventType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Invite" DROP CONSTRAINT "Invite_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Invite" DROP CONSTRAINT "Invite_usedByUserId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "vouchNote" TEXT,
ADD COLUMN     "vouchedById" TEXT;

-- DropTable
DROP TABLE "Invite";

-- DropEnum
DROP TYPE "InviteStatus";

-- CreateIndex
CREATE INDEX "User_status_createdAt_idx" ON "User"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_vouchedById_fkey" FOREIGN KEY ("vouchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

