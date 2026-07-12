-- Social features phase 1 (docs/social-features-plan.md): profile fields on
-- User plus the Item/UserItem inventory scaffolding that leagues (trophies)
-- and the cosmetics store will write into.

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('TROPHY', 'BADGE', 'TITLE', 'FRAME', 'BACKGROUND');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('SEASON_TROPHY', 'ACHIEVEMENT', 'PURCHASE', 'ADMIN_GRANT');

-- CreateEnum
CREATE TYPE "EquipSlot" AS ENUM ('BADGE', 'TITLE', 'FRAME', 'BACKGROUND');

-- AlterTable: username is added nullable, backfilled from the display name,
-- then constrained — existing rows predate the column.
ALTER TABLE "User" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "username" TEXT;

-- Backfill: slugify the display name (lowercase, non-alphanumeric runs → "-",
-- trimmed, clamped to 20 chars), fall back to "player" when nothing usable
-- survives, then break collisions with a numeric suffix in signup order.
-- If a suffixed slug still collides, the unique index below fails the
-- migration loudly rather than corrupting handles.
WITH slugged AS (
  SELECT
    id,
    "createdAt",
    left(
      trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')),
      20
    ) AS slug
  FROM "User"
),
cleaned AS (
  SELECT
    id,
    "createdAt",
    CASE
      WHEN length(trim(BOTH '-' FROM slug)) >= 3 THEN trim(BOTH '-' FROM slug)
      ELSE 'player'
    END AS slug
  FROM slugged
),
numbered AS (
  SELECT
    id,
    slug,
    row_number() OVER (PARTITION BY slug ORDER BY "createdAt", id) AS rn
  FROM cleaned
)
UPDATE "User" u
SET "username" = CASE
  WHEN n.rn = 1 THEN n.slug
  ELSE left(n.slug, 20 - length('-' || n.rn::text)) || '-' || n.rn::text
END
FROM numbered n
WHERE u.id = n.id;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "style" JSONB,
    "storeCost" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" "ItemSource" NOT NULL,
    "provenance" JSONB,
    "grantKey" TEXT,
    "equippedSlot" "EquipSlot",
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Item_slug_key" ON "Item"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "UserItem_grantKey_key" ON "UserItem"("grantKey");

-- CreateIndex
CREATE INDEX "UserItem_userId_grantedAt_idx" ON "UserItem"("userId", "grantedAt");

-- CreateIndex
CREATE INDEX "UserItem_itemId_idx" ON "UserItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
