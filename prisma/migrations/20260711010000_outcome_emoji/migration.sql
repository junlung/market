-- Optional emoji decoration per outcome. Nullable, no backfill; purely
-- additive, so it is safe to apply while the previous deploy still serves
-- (Prisma clients select only the columns they were generated with).
ALTER TABLE "Outcome" ADD COLUMN "emoji" TEXT;
