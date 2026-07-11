/**
 * The curated outcome swatch set. Tokens map to the `--oc-*` CSS variables in
 * globals.css, which hold theme-appropriate values (the six deal-order hues
 * are validator-checked for CVD + contrast on both surfaces). Colors bind to
 * outcomes at creation and are never re-derived from rank.
 *
 * A color can also be a raw `#rrggbb` hex — the custom escape hatch. Hex
 * colors render as-given in both themes; the outcome editor shows a
 * readability warning instead of enforcing rules.
 */
export const OUTCOME_COLORS = [
  "blue",
  "orange",
  "purple",
  "teal",
  "amber",
  "pink",
  "lime",
  "magenta",
  "slate",
  "brown",
  "green",
  "red",
] as const;

export type OutcomeColor = (typeof OUTCOME_COLORS)[number];

/**
 * What the swatch grid shows, in rainbow order. Deliberately fewer than the
 * valid token set: one hue per family so no two dots read alike — lime,
 * magenta, and brown remain valid (and renderable) but collide with their
 * neighbors at dot size, so the picker hides them; the custom hex picker is
 * the pressure valve for anything else.
 */
export const PICKER_COLORS: OutcomeColor[] = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "slate",
];

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
  "slate",
];

/** The binary preset: Yes = green, No = red — visually identical to the old app. */
export const BINARY_PRESET = [
  { label: "Yes", color: "green" as string, emoji: "" },
  { label: "No", color: "red" as string, emoji: "" },
];

export function isOutcomeColor(value: string): value is OutcomeColor {
  return (OUTCOME_COLORS as readonly string[]).includes(value);
}

export function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** True for anything storable in Outcome.color: a token or a #rrggbb hex. */
export function isValidOutcomeColor(value: string) {
  return isOutcomeColor(value) || isHexColor(value);
}

/** CSS value for an outcome color: `var(--oc-<token>)`, or the hex verbatim. */
export function outcomeColorVar(color: string) {
  if (isHexColor(color)) {
    return color;
  }
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

/**
 * Number of user-perceived characters. Flag and ZWJ emoji are single
 * graphemes made of many code units (England's flag is 16) — never measure
 * emoji fields with .length or maxLength.
 */
export function graphemeCount(value: string) {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter().segment(value)].length;
  }
  return [...value].length;
}

/** Display form of an outcome label — emoji-prefixed when one is set. */
export function outcomeDisplayLabel(outcome: { label: string; emoji?: string | null }) {
  const emoji = outcome.emoji?.trim();
  return emoji ? `${emoji} ${outcome.label}` : outcome.label;
}

/**
 * WCAG relative-luminance contrast of a hex color against a surface —
 * powers the "hard to read" hint on custom colors in the outcome editor.
 */
export function hexContrast(hex: string, surfaceHex: string) {
  const luminance = (value: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [a, b] = [luminance(hex), luminance(surfaceHex)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
