import type { ItemSource, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Grants an item instance into a user's inventory. Pass `grantKey` from
 * automated flows (season finalization, achievements) — re-runs then return
 * the existing grant instead of duplicating it, same idea as the weekly
 * allowance's [userId, allowanceWeek] key.
 */
export async function grantItem(input: {
  userId: string;
  itemId: string;
  source: ItemSource;
  provenance?: Prisma.InputJsonValue;
  grantKey?: string;
}) {
  try {
    return await prisma.userItem.create({ data: input });
  } catch (error) {
    const isUniqueViolation =
      error && typeof error === "object" && "code" in error && error.code === "P2002";
    if (isUniqueViolation && input.grantKey) {
      return prisma.userItem.findUniqueOrThrow({ where: { grantKey: input.grantKey } });
    }
    throw error;
  }
}

/** A user's full inventory, newest grants first, item definitions included. */
export async function listUserItems(userId: string) {
  return prisma.userItem.findMany({
    where: { userId, item: { active: true } },
    include: { item: true },
    orderBy: { grantedAt: "desc" },
  });
}
