/**
 * Canonical Global League market categories. Markets store the slug in
 * `Market.category` (still a plain String column — the constraint lives at the
 * service layer, not in Postgres, so remapping stays trivial). Adding a
 * category is a one-line change here; slugs are effectively permanent once
 * achievements mint, because achievement keys embed them.
 *
 * Custom leagues don't use this list — each league carries its own
 * owner-curated `League.categories` labels (no slugs, no achievements).
 */

export type CategoryDef = {
  slug: string;
  label: string;
  /** decoration for tabs/cards and the generated achievement glyphs */
  emoji: string;
  /** Wildcard is the escape hatch for jokes and one-offs — no achievements */
  achievementEligible: boolean;
};

export const GLOBAL_CATEGORIES = [
  { slug: "sports", label: "Sports", emoji: "🏈", achievementEligible: true },
  { slug: "weather", label: "Weather", emoji: "🌦️", achievementEligible: true },
  { slug: "news", label: "News", emoji: "📰", achievementEligible: true },
  { slug: "pop-culture", label: "Pop Culture", emoji: "🍿", achievementEligible: true },
  { slug: "politics", label: "Politics", emoji: "🏛️", achievementEligible: true },
  { slug: "wildcard", label: "Wildcard", emoji: "🃏", achievementEligible: false },
] as const satisfies readonly CategoryDef[];

export type GlobalCategorySlug = (typeof GLOBAL_CATEGORIES)[number]["slug"];

/** The slugs that generate win-count achievements (everything but Wildcard). */
export type EligibleCategorySlug = Extract<
  (typeof GLOBAL_CATEGORIES)[number],
  { achievementEligible: true }
>["slug"];

export const CATEGORY_BY_SLUG: ReadonlyMap<string, CategoryDef> = new Map(
  GLOBAL_CATEGORIES.map((def) => [def.slug, def]),
);

export function isGlobalCategory(value: string): value is GlobalCategorySlug {
  return CATEGORY_BY_SLUG.has(value);
}

/**
 * Display name for a stored category value: canonical slugs render their
 * label; anything else (custom-league labels, not-yet-remapped history)
 * renders as stored.
 */
export function categoryLabel(value: string) {
  return CATEGORY_BY_SLUG.get(value)?.label ?? value;
}

/** Label with the category's emoji prefix, for tabs and cards. */
export function categoryDisplay(value: string) {
  const def = CATEGORY_BY_SLUG.get(value);
  return def ? `${def.emoji} ${def.label}` : value;
}

export type CategoryOption = { value: string; label: string };

/** The market form's options: canonical slugs for Global markets. */
export function globalCategoryOptions(): CategoryOption[] {
  return GLOBAL_CATEGORIES.map((def) => ({
    value: def.slug,
    label: `${def.emoji} ${def.label}`,
  }));
}

/** The market form's options for a custom league: its owner-curated labels. */
export function leagueCategoryOptions(categories: string[]): CategoryOption[] {
  return categories.map((category) => ({ value: category, label: category }));
}
