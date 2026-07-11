/**
 * The curated outcome swatch set. Tokens map to the `--oc-*` CSS variables in
 * globals.css, which hold theme-appropriate values validated as an ordered
 * set (CVD + contrast) on both surfaces. Colors bind to outcomes at creation
 * and are never re-derived from rank.
 */
export const OUTCOME_COLORS = [
  "blue",
  "orange",
  "purple",
  "teal",
  "amber",
  "pink",
  "green",
  "red",
] as const;

export type OutcomeColor = (typeof OUTCOME_COLORS)[number];

/**
 * Auto-deal order for multi-outcome markets: non-semantic hues first —
 * green/red read as win/lose, so they stay the Yes/No preset pair and are
 * only dealt once everything else is taken.
 */
export const MULTI_OUTCOME_DEAL_ORDER: OutcomeColor[] = [
  "blue",
  "orange",
  "purple",
  "teal",
  "amber",
  "pink",
];

/** The binary preset: Yes = green, No = red — visually identical to the old app. */
export const BINARY_PRESET = [
  { label: "Yes", color: "green" as OutcomeColor },
  { label: "No", color: "red" as OutcomeColor },
];

export function isOutcomeColor(value: string): value is OutcomeColor {
  return (OUTCOME_COLORS as readonly string[]).includes(value);
}

/** CSS value for an outcome color token, e.g. `var(--oc-blue)`. */
export function outcomeColorVar(color: string) {
  return `var(--oc-${isOutcomeColor(color) ? color : "blue"})`;
}

/** Translucent tint of an outcome color for chip/row backgrounds. */
export function outcomeColorBg(color: string, percent = 12) {
  return `color-mix(in srgb, ${outcomeColorVar(color)} ${percent}%, transparent)`;
}

/** Default color for the nth outcome row in the creation form. */
export function defaultOutcomeColor(index: number, outcomeCount: number): OutcomeColor {
  if (outcomeCount === 2) {
    return index === 0 ? "green" : "red";
  }
  return MULTI_OUTCOME_DEAL_ORDER[index % MULTI_OUTCOME_DEAL_ORDER.length];
}
