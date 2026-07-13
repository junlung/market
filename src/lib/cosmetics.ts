/**
 * Cosmetic style schemas (Phase 3) — the typed contract between Item.style
 * Json and the renderers. Client-safe: no server imports.
 *
 * Two discriminants: Item.kind (a typed column) picks the SLOT the style
 * belongs to; `renderer` inside the Json picks the TECHNOLOGY. "model3d" is
 * accepted by the schema today (so low-poly WebGL trophies slot in with zero
 * migration) but renders as a placeholder until the viewer ships.
 *
 * Colors are hex-locked — never arbitrary CSS strings — because style Json
 * flows into inline `style` attributes and (in 3b) is admin-editable as raw
 * Json. parseItemStyle never throws: junk renders as nothing, not a crash.
 */
import { EquipSlot, ItemKind } from "@prisma/client";
import { z } from "zod";
import { graphemeCount } from "@/lib/outcome-colors";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a #rrggbb hex color.");

export const frameStyleSchema = z.object({
  renderer: z.literal("css"),
  v: z.number().int().optional(),
  /** ring color; with ring2 the ring becomes a conic gradient */
  ring: hex,
  ring2: hex.optional(),
  /** outer glow color (box-shadow) */
  glow: hex.optional(),
  animate: z.enum(["none", "pulse"]).optional(),
});

export const badgeStyleSchema = z.object({
  renderer: z.literal("emoji"),
  v: z.number().int().optional(),
  glyph: z
    .string()
    .min(1)
    .max(16)
    .refine((value) => graphemeCount(value) === 1, "One emoji only."),
});

export const titleStyleSchema = z.object({
  renderer: z.literal("css"),
  v: z.number().int().optional(),
  text: z.string().trim().min(1).max(24),
  color: hex.optional(),
  /** two-stop gradient text; wins over color when present */
  gradient: z.tuple([hex, hex]).optional(),
});

export const bannerStyleSchema = z.object({
  renderer: z.literal("css"),
  v: z.number().int().optional(),
  from: hex,
  to: hex,
  direction: z.enum(["to-r", "to-br", "to-b"]).optional(),
});

export const trophyStyleSchema = z.discriminatedUnion("renderer", [
  z.object({
    renderer: z.literal("emoji"),
    v: z.number().int().optional(),
    emoji: z.string().min(1).max(16),
  }),
  z.object({
    renderer: z.literal("model3d"),
    v: z.number().int().optional(),
    /** path/URL of a .glb asset — rendered as a placeholder tile until the WebGL viewer ships */
    src: z.string().min(1).max(500),
    fallbackEmoji: z.string().max(16).optional(),
  }),
]);

export type FrameStyle = z.infer<typeof frameStyleSchema>;
export type BadgeStyle = z.infer<typeof badgeStyleSchema>;
export type TitleStyle = z.infer<typeof titleStyleSchema>;
export type BannerStyle = z.infer<typeof bannerStyleSchema>;
export type TrophyStyle = z.infer<typeof trophyStyleSchema>;

export type ParsedItemStyle =
  | { kind: "FRAME"; style: FrameStyle }
  | { kind: "BADGE"; style: BadgeStyle }
  | { kind: "TITLE"; style: TitleStyle }
  | { kind: "BACKGROUND"; style: BannerStyle }
  | { kind: "TROPHY"; style: TrophyStyle };

/** Cosmetic kinds map 1:1 onto equip slots; TROPHY is display-only. */
export const KIND_TO_SLOT: Partial<Record<ItemKind, EquipSlot>> = {
  [ItemKind.BADGE]: EquipSlot.BADGE,
  [ItemKind.TITLE]: EquipSlot.TITLE,
  [ItemKind.FRAME]: EquipSlot.FRAME,
  [ItemKind.BACKGROUND]: EquipSlot.BACKGROUND,
};

/** What renderers receive per user: the parsed style for each equipped slot. */
export type EquippedCosmetics = {
  frame: FrameStyle | null;
  badge: BadgeStyle | null;
  title: TitleStyle | null;
  banner: BannerStyle | null;
};

export const NO_COSMETICS: EquippedCosmetics = {
  frame: null,
  badge: null,
  title: null,
  banner: null,
};

/**
 * Parses an Item.style Json for its kind. Never throws; returns null for
 * anything unrenderable so surfaces degrade to the undecorated identity.
 * Legacy trophies ({ emoji } with no renderer — the 2a trophy defs) are
 * upgraded in place.
 */
export function parseItemStyle(kind: ItemKind, style: unknown): ParsedItemStyle | null {
  if (style === null || typeof style !== "object") {
    return null;
  }

  switch (kind) {
    case ItemKind.FRAME: {
      const parsed = frameStyleSchema.safeParse(style);
      return parsed.success ? { kind: "FRAME", style: parsed.data } : null;
    }
    case ItemKind.BADGE: {
      const parsed = badgeStyleSchema.safeParse(style);
      return parsed.success ? { kind: "BADGE", style: parsed.data } : null;
    }
    case ItemKind.TITLE: {
      const parsed = titleStyleSchema.safeParse(style);
      return parsed.success ? { kind: "TITLE", style: parsed.data } : null;
    }
    case ItemKind.BACKGROUND: {
      const parsed = bannerStyleSchema.safeParse(style);
      return parsed.success ? { kind: "BACKGROUND", style: parsed.data } : null;
    }
    case ItemKind.TROPHY: {
      const upgraded =
        "renderer" in style ? style : { renderer: "emoji" as const, ...(style as object) };
      const parsed = trophyStyleSchema.safeParse(upgraded);
      return parsed.success ? { kind: "TROPHY", style: parsed.data } : null;
    }
  }
}
