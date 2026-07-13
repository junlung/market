import { GemLedgerEntryType, ItemSource } from "@prisma/client";
import { withSerializableRetry } from "@/lib/server/tx";

/**
 * Buys a store item with gems: ownership check → balance check → grant +
 * debit, all in one SERIALIZABLE transaction. The balance check is a SUM
 * predicate that row locks can't guard (same rationale as bets — see tx.ts),
 * so SSI is the enforcement mechanism; the partial unique on
 * (userId, itemId) WHERE source = 'PURCHASE' is the double-buy backstop.
 * A retried race re-runs, hits the ownership check, and surfaces the
 * friendly error — two debits are impossible because grant and debit commit
 * atomically.
 */
export async function purchaseItem(userId: string, itemSlug: string) {
  return withSerializableRetry(async (tx) => {
    const item = await tx.item.findUnique({ where: { slug: itemSlug } });
    if (!item || !item.active) {
      throw new Error("That item isn't available.");
    }
    if (item.storeCost === null) {
      throw new Error("That item can't be purchased — it has to be earned.");
    }

    const owned = await tx.userItem.findFirst({
      where: { userId, itemId: item.id, source: ItemSource.PURCHASE },
    });
    if (owned) {
      throw new Error("You already own this item.");
    }

    const balance = await tx.gemLedgerEntry.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    if ((balance._sum.amount ?? 0) < item.storeCost) {
      throw new Error("Not enough gems.");
    }

    const grant = await tx.userItem.create({
      data: { userId, itemId: item.id, source: ItemSource.PURCHASE },
    });

    await tx.gemLedgerEntry.create({
      data: {
        userId,
        type: GemLedgerEntryType.STORE_PURCHASE,
        amount: -item.storeCost,
        itemId: item.id,
        description: `Store purchase — ${item.name}`,
      },
    });

    return grant;
  });
}
