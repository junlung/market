-- Per-league market categories: custom leagues carry an owner-curated label
-- list. Backfill each existing custom league from the distinct categories its
-- markets already use, falling back to a single "General" so the market form
-- always has something to offer.

-- AlterTable
ALTER TABLE "League" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "League" l
SET "categories" = COALESCE(
  (
    SELECT array_agg(DISTINCT m."category" ORDER BY m."category")
    FROM "Market" m
    WHERE m."leagueId" = l."id"
  ),
  ARRAY['General']
)
WHERE l."isGlobal" = false;
