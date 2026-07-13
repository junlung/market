"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EquipSlot, ItemSource } from "@prisma/client";
import {
  createItem,
  equipItem,
  grantItem,
  setItemActive,
  unequipSlot,
  updateItem,
} from "@/lib/server/item-service";
import type { ActionResult } from "@/lib/server/market-service";
import { purchaseItem } from "@/lib/server/store-service";
import { requireAdminSession, requireSession } from "@/lib/session";
import { grantItemAdminSchema, itemFormSchema } from "@/lib/validation";

// equipped cosmetics render nearly everywhere identities do — revalidate
// broadly, same rationale as display-name renames
function revalidateIdentityViews() {
  revalidatePath("/", "layout");
}

export async function equipItemAction(userItemId: string): Promise<ActionResult> {
  const session = await requireSession();

  if (typeof userItemId !== "string" || userItemId.length === 0) {
    return { error: "Invalid item." };
  }

  try {
    await equipItem(session.user.id, userItemId);
    revalidateIdentityViews();
    return { success: "Equipped." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to equip item." };
  }
}

export async function unequipSlotAction(slot: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!Object.values(EquipSlot).includes(slot as EquipSlot)) {
    return { error: "Invalid slot." };
  }

  try {
    await unequipSlot(session.user.id, slot as EquipSlot);
    revalidateIdentityViews();
    return { success: "Unequipped." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to unequip." };
  }
}

// --- admin authoring (Phase 3b) ---

function parseItemForm(formData: FormData) {
  const parsed = itemFormSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    description: formData.get("description"),
    kind: formData.get("kind"),
    storeCost: formData.get("storeCost") ?? "",
    active: formData.get("active") === "on" || formData.get("active") === "true",
    style: formData.get("style"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid item." } as const;
  }

  let style: unknown;
  try {
    style = JSON.parse(parsed.data.style);
  } catch {
    return { error: "Style isn't valid JSON." } as const;
  }

  return { data: { ...parsed.data, style } } as const;
}

function revalidateItemViews() {
  revalidatePath("/admin/items");
  revalidatePath("/store");
  revalidatePath("/", "layout"); // equipped instances render everywhere
}

export async function createItemAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdminSession();
  const parsed = parseItemForm(formData);
  if ("error" in parsed) {
    return { error: parsed.error };
  }

  let itemId: string;
  try {
    const item = await createItem(parsed.data);
    itemId = item.id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create item." };
  }

  revalidateItemViews();
  redirect(`/admin/items/${itemId}`);
}

export async function updateItemAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdminSession();
  const itemId = String(formData.get("itemId") ?? "");
  const parsed = parseItemForm(formData);
  if ("error" in parsed) {
    return { error: parsed.error };
  }

  try {
    // slug is immutable — strip it from the update payload
    const { slug, ...rest } = parsed.data;
    void slug;
    await updateItem(itemId, rest);
    revalidateItemViews();
    return { success: "Item updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update item." };
  }
}

export async function setItemActiveAction(itemId: string, active: boolean): Promise<ActionResult> {
  await requireAdminSession();
  try {
    await setItemActive(itemId, active);
    revalidateItemViews();
    return { success: active ? "Item is live." : "Item retired — it stops rendering everywhere." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update item." };
  }
}

export async function adminGrantItemAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdminSession();
  const parsed = grantItemAdminSchema.safeParse({
    itemId: formData.get("itemId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) {
    return { error: "Pick a member." };
  }

  try {
    await grantItem({
      userId: parsed.data.userId,
      itemId: parsed.data.itemId,
      source: ItemSource.ADMIN_GRANT,
    });
    revalidateItemViews();
    return { success: "Granted — it's in their locker." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to grant item." };
  }
}

export async function purchaseItemAction(itemSlug: string): Promise<ActionResult> {
  const session = await requireSession();

  if (typeof itemSlug !== "string" || itemSlug.length === 0) {
    return { error: "Invalid item." };
  }

  try {
    await purchaseItem(session.user.id, itemSlug);
    revalidatePath("/store");
    revalidatePath("/account");
    revalidatePath("/", "layout"); // nav gem balance
    return { success: "It's yours — equip it from your locker." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Purchase failed." };
  }
}
