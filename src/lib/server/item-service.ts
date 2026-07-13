import { EquipSlot, ItemKind, ItemSource, type Prisma } from "@prisma/client";
import {
  KIND_TO_SLOT,
  NO_COSMETICS,
  parseItemStyle,
  type EquippedCosmetics,
  type ParsedItemStyle,
} from "@/lib/cosmetics";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/server/tx";

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

// ---------------------------------------------------------------------------
// Equipped cosmetics (Phase 3)
// ---------------------------------------------------------------------------

/**
 * The equipped cosmetics for a batch of users in one query — the convention
 * is ONE call per page/view model (whoever assembles the rows fetches the
 * union of userIds), never per-row lookups. Styles are parsed server-side so
 * client components only ever receive typed plain objects or null; a
 * retired (inactive) item stops rendering everywhere without an unequip.
 */
export async function getEquippedCosmetics(
  userIds: string[],
): Promise<Map<string, EquippedCosmetics>> {
  const map = new Map<string, EquippedCosmetics>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return map;
  }

  const rows = await prisma.userItem.findMany({
    where: {
      userId: { in: unique },
      equippedSlot: { not: null },
      item: { active: true },
    },
    select: {
      userId: true,
      equippedSlot: true,
      item: { select: { kind: true, style: true } },
    },
  });

  for (const row of rows) {
    const parsed = parseItemStyle(row.item.kind, row.item.style);
    if (!parsed) {
      continue;
    }
    const entry = map.get(row.userId) ?? { ...NO_COSMETICS };
    switch (parsed.kind) {
      case "FRAME":
        entry.frame = parsed.style;
        break;
      case "BADGE":
        entry.badge = parsed.style;
        break;
      case "TITLE":
        entry.title = parsed.style;
        break;
      case "BACKGROUND":
        entry.banner = parsed.style;
        break;
      case "TROPHY":
        continue; // trophies can't be equipped; defensive
    }
    map.set(row.userId, entry);
  }

  return map;
}

/** Convenience for single-user surfaces (profile, nav, account). */
export async function getUserCosmetics(userId: string): Promise<EquippedCosmetics> {
  const map = await getEquippedCosmetics([userId]);
  return map.get(userId) ?? NO_COSMETICS;
}

/**
 * Equips an owned item into its kind's slot, displacing whatever held the
 * slot. SERIALIZABLE + the partial unique on (userId, equippedSlot) make a
 * concurrent double-equip collapse to one winner (P2002 → retry → clean
 * re-run) instead of two items sharing a slot.
 */
export async function equipItem(userId: string, userItemId: string) {
  return withSerializableRetry(async (tx) => {
    const owned = await tx.userItem.findFirst({
      where: { id: userItemId, userId },
      include: { item: { select: { kind: true, active: true } } },
    });
    if (!owned) {
      throw new Error("That item isn't in your locker.");
    }
    if (!owned.item.active) {
      throw new Error("That item has been retired.");
    }
    const slot = KIND_TO_SLOT[owned.item.kind];
    if (!slot) {
      throw new Error("Trophies are display-only — they live in your trophy case.");
    }

    await tx.userItem.updateMany({
      where: { userId, equippedSlot: slot },
      data: { equippedSlot: null },
    });

    return tx.userItem.update({
      where: { id: owned.id },
      data: { equippedSlot: slot },
    });
  });
}

export async function unequipSlot(userId: string, slot: EquipSlot) {
  await prisma.userItem.updateMany({
    where: { userId, equippedSlot: slot },
    data: { equippedSlot: null },
  });
}

// ---------------------------------------------------------------------------
// Locker + store reads
// ---------------------------------------------------------------------------

export type LockerItem = {
  userItemId: string;
  slug: string;
  name: string;
  description: string;
  kind: ItemKind;
  source: ItemSource;
  equipped: boolean;
  grantedAt: Date;
  style: ParsedItemStyle | null;
};

/** The equippable inventory (everything but trophies), styles pre-parsed. */
export async function getLocker(userId: string): Promise<LockerItem[]> {
  const items = await listUserItems(userId);
  return items
    .filter((owned) => owned.item.kind !== ItemKind.TROPHY)
    .map((owned) => ({
      userItemId: owned.id,
      slug: owned.item.slug,
      name: owned.item.name,
      description: owned.item.description,
      kind: owned.item.kind,
      source: owned.source,
      equipped: owned.equippedSlot !== null,
      grantedAt: owned.grantedAt,
      style: parseItemStyle(owned.item.kind, owned.item.style),
    }));
}

export type StoreCatalogItem = {
  itemId: string;
  slug: string;
  name: string;
  description: string;
  kind: ItemKind;
  storeCost: number;
  style: ParsedItemStyle | null;
  owned: boolean;
};

/** Active, priced items grouped for the store, with the viewer's owned flags. */
export async function getStoreCatalog(viewerId: string): Promise<StoreCatalogItem[]> {
  await ensureStarterCatalog();

  const [items, owned] = await Promise.all([
    prisma.item.findMany({
      where: { active: true, storeCost: { not: null } },
      orderBy: [{ kind: "asc" }, { storeCost: "asc" }],
    }),
    prisma.userItem.findMany({
      where: { userId: viewerId, source: ItemSource.PURCHASE },
      select: { itemId: true },
    }),
  ]);
  const ownedIds = new Set(owned.map((row) => row.itemId));

  return items.map((item) => ({
    itemId: item.id,
    slug: item.slug,
    name: item.name,
    description: item.description,
    kind: item.kind,
    storeCost: item.storeCost!,
    style: parseItemStyle(item.kind, item.style),
    owned: ownedIds.has(item.id),
  }));
}

// ---------------------------------------------------------------------------
// Starter catalog (Phase 3a — admin authoring UI arrives in 3b)
// ---------------------------------------------------------------------------

const STARTER_CATALOG: Array<{
  slug: string;
  name: string;
  description: string;
  kind: ItemKind;
  style: Prisma.InputJsonValue;
  storeCost: number | null;
}> = [
  {
    slug: "frame-gold",
    name: "Gold Ring",
    description: "A solid gold ring with a warm glow.",
    kind: ItemKind.FRAME,
    style: { renderer: "css", ring: "#eab308", glow: "#facc15" },
    storeCost: 200,
  },
  {
    slug: "frame-ember",
    name: "Ember",
    description: "A smoldering red aura.",
    kind: ItemKind.FRAME,
    style: { renderer: "css", ring: "#dc2626", glow: "#f97316", animate: "pulse" },
    storeCost: 300,
  },
  {
    slug: "frame-prism",
    name: "Prism",
    description: "A shifting two-tone gradient ring.",
    kind: ItemKind.FRAME,
    style: { renderer: "css", ring: "#8b5cf6", ring2: "#06b6d4" },
    storeCost: 150,
  },
  {
    slug: "badge-flame",
    name: "Flame",
    description: "Run hot next to your name.",
    kind: ItemKind.BADGE,
    style: { renderer: "emoji", glyph: "🔥" },
    storeCost: 100,
  },
  {
    slug: "badge-shark",
    name: "Shark",
    description: "Apex predator of the pools.",
    kind: ItemKind.BADGE,
    style: { renderer: "emoji", glyph: "🦈" },
    storeCost: 150,
  },
  {
    slug: "badge-dice",
    name: "Dice",
    description: "Fortune favors the bold.",
    kind: ItemKind.BADGE,
    style: { renderer: "emoji", glyph: "🎲" },
    storeCost: 75,
  },
  {
    slug: "title-high-roller",
    name: "High Roller",
    description: "The title says it all.",
    kind: ItemKind.TITLE,
    style: { renderer: "css", text: "High Roller", color: "#eab308" },
    storeCost: 175,
  },
  {
    // achievement-only precedent (decision #5's watch item): desirable items
    // the store can't sell, so gem wealth doesn't buy every status symbol.
    // Granted by admins for now; earning rules can come later.
    slug: "title-oracle",
    name: "The Oracle",
    description: "Sees it coming. Earned, never bought.",
    kind: ItemKind.TITLE,
    style: { renderer: "css", text: "The Oracle", gradient: ["#8b5cf6", "#06b6d4"] },
    storeCost: null,
  },
  {
    slug: "banner-dusk",
    name: "Dusk",
    description: "A profile banner in fading violet.",
    kind: ItemKind.BACKGROUND,
    style: { renderer: "css", from: "#4c1d95", to: "#be185d", direction: "to-r" },
    storeCost: 150,
  },
  {
    slug: "banner-mint",
    name: "Mint",
    description: "A profile banner in cool green.",
    kind: ItemKind.BACKGROUND,
    style: { renderer: "css", from: "#065f46", to: "#0ea5e9", direction: "to-br" },
    storeCost: 150,
  },
];

// ---------------------------------------------------------------------------
// Admin item authoring (Phase 3b)
// ---------------------------------------------------------------------------

/** Every item — inactive included — with owner counts, for /admin/items. */
export async function listAllItems() {
  return prisma.item.findMany({
    include: { _count: { select: { userItems: true } } },
    orderBy: [{ active: "desc" }, { kind: "asc" }, { createdAt: "desc" }],
  });
}

export async function getItemById(itemId: string) {
  return prisma.item.findUnique({
    where: { id: itemId },
    include: { _count: { select: { userItems: true } } },
  });
}

type ItemInput = {
  slug: string;
  name: string;
  description: string;
  kind: ItemKind;
  style: unknown;
  storeCost: number | null;
  active: boolean;
};

/** Style must parse for its kind — the raw-Json editor can't persist junk. */
function validateItemStyle(input: Pick<ItemInput, "kind" | "style">) {
  if (!parseItemStyle(input.kind, input.style)) {
    throw new Error("That style doesn't render for this item kind — check the fields.");
  }
}

export async function createItem(input: ItemInput) {
  validateItemStyle(input);
  const existing = await prisma.item.findUnique({ where: { slug: input.slug } });
  if (existing) {
    throw new Error("That slug is taken.");
  }
  return prisma.item.create({
    data: { ...input, style: input.style as Prisma.InputJsonValue },
  });
}

export async function updateItem(itemId: string, input: Omit<ItemInput, "slug">) {
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new Error("Item not found.");
  }
  if (input.kind !== item.kind) {
    // kind changes would orphan equipped slots and reprice grants — recreate instead
    throw new Error("An item's kind is fixed — create a new item instead.");
  }
  validateItemStyle(input);
  return prisma.item.update({
    where: { id: itemId },
    data: { ...input, style: input.style as Prisma.InputJsonValue },
  });
}

export async function setItemActive(itemId: string, active: boolean) {
  return prisma.item.update({ where: { id: itemId }, data: { active } });
}

/**
 * Seeds the starter cosmetics, idempotently (upsert-by-slug — the
 * ensureSeasonTrophyItems pattern). Self-healing: called from the store read
 * so fresh DBs get a catalog without a deploy step; also run by prisma/seed.
 */
export async function ensureStarterCatalog() {
  return Promise.all(
    STARTER_CATALOG.map((def) =>
      prisma.item.upsert({
        where: { slug: def.slug },
        update: {},
        create: def,
      }),
    ),
  );
}
