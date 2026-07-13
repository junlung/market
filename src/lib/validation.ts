import { ItemKind } from "@prisma/client";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { graphemeCount } from "@/lib/outcome-colors";
import { RESERVED_USERNAMES, USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "@/lib/username";

const localDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid datetime");

const points = z.coerce.number().int("Whole points only.").min(1);

// shape-loose on purpose: migration-backfilled Outcome ids are SQL-generated
// uuids, not cuids — membership is asserted inside the transaction anyway
const outcomeIdSchema = z.string().trim().min(10, "Pick an outcome.");

const outcomesSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1, "Every outcome needs a label.").max(40),
      // a curated token or a custom "#rrggbb" hex (the escape hatch)
      color: z
        .string()
        .trim()
        .regex(
          /^(blue|orange|purple|teal|amber|pink|lime|magenta|slate|brown|green|red|#[0-9a-f]{6})$/i,
          "Pick a swatch or a valid hex color.",
        ),
      // flag/ZWJ emoji are one grapheme but many code units — cap graphemes
      emoji: z
        .string()
        .trim()
        .max(64)
        .refine((value) => graphemeCount(value) <= 2, "One or two emoji only.")
        .optional(),
    }),
  )
  .min(2, "A market needs at least 2 outcomes.")
  .max(6, "Markets max out at 6 outcomes.")
  .refine(
    (outcomes) => new Set(outcomes.map((o) => o.label.toLowerCase())).size === outcomes.length,
    "Outcome labels must be unique.",
  );

const marketFieldsSchema = z.object({
  title: z.string().trim().min(5, "Question needs at least 5 characters."),
  description: z.string().trim().min(10, "Description needs at least 10 characters — spell out what counts for each outcome."),
  category: z.string().trim().min(2, "Category needs at least 2 characters."),
  closeTime: localDateTimeSchema,
  resolveTime: localDateTimeSchema,
  resolutionSource: z.string().trim().min(1, "Resolution source is required."),
  outcomes: outcomesSchema,
});

/** All validation problems keyed by field name, for inline form errors. */
export function collectFieldErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}

export const marketFormSchema = marketFieldsSchema.extend({
  maxStakePerUser: points.max(100_000).optional(),
  rakeBps: z.coerce.number().int().min(0).max(2000).optional(),
});

export const proposeMarketSchema = marketFieldsSchema;

export const reviewProposalSchema = z.object({
  marketId: z.string().cuid(),
  note: z.string().trim().max(500).optional(),
  openNow: z.coerce.boolean().optional(),
});

export const rejectProposalSchema = z.object({
  marketId: z.string().cuid(),
  reason: z.string().trim().min(3).max(500),
});

export const resolveMarketSchema = z.object({
  marketId: z.string().cuid(),
  winningOutcomeId: outcomeIdSchema,
  resolutionSource: z.string().trim().min(1, "Resolution source is required.").max(280),
  notes: z.string().trim().max(500).optional(),
});

export const cancelMarketSchema = z.object({
  marketId: z.string().cuid(),
  reason: z.string().trim().min(5).max(280),
});

export const betSchema = z.object({
  marketId: z.string().cuid(),
  outcomeId: outcomeIdSchema,
  // per-request sanity ceiling; the real per-market cap is enforced in the bet transaction
  amount: points.max(appConfig.maxBetAmount),
});

export const commentSchema = z.object({
  marketId: z.string().cuid(),
  body: z.string().trim().min(1).max(500),
});

export const deleteCommentSchema = z.object({
  commentId: z.string().cuid(),
});

export const usernameValueSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN, `Username needs at least ${USERNAME_MIN} characters.`)
  .max(USERNAME_MAX, `Username maxes out at ${USERNAME_MAX} characters.`)
  .regex(USERNAME_PATTERN, "Lowercase letters, numbers, and hyphens only — no leading or trailing hyphen.")
  .refine((value) => !RESERVED_USERNAMES.has(value), "That username is reserved.");

export const usernameSchema = z.object({
  username: usernameValueSchema,
});

// empty clears the bio
export const bioSchema = z.object({
  bio: z.string().trim().max(280, "Bio maxes out at 280 characters."),
});

export const displayNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name needs at least 2 characters.")
    .max(30, "Name maxes out at 30 characters."),
});

export const vouchSchema = z.object({
  userId: z.string().cuid(),
  note: z.string().trim().max(280).optional(),
});

export const reviewUserSchema = z.object({
  userId: z.string().cuid(),
  note: z.string().trim().max(280).optional(),
});

export const rejectUserSchema = z.object({
  userId: z.string().cuid(),
  reason: z.string().trim().max(280).optional(),
});

// --- Leagues (2b) ---

export const leagueFormSchema = z.object({
  name: z.string().trim().min(3, "League names need at least 3 characters.").max(60),
  description: z.string().trim().max(280, "Description maxes out at 280 characters.").optional(),
  startingStack: z.coerce
    .number()
    .int("Whole points only.")
    .min(1, "The starting stack must be at least 1 point.")
    .max(1_000_000),
  weeklyAllowance: z.coerce
    .number()
    .int("Whole points only.")
    .min(0, "Use 0 to turn the allowance off.")
    .max(100_000),
  defaultRakeBps: z.coerce.number().int().min(0).max(2000, "Rake maxes out at 2000 bps (20%)."),
  defaultMaxStakePerUser: z.coerce
    .number()
    .int("Whole points only.")
    .min(1, "The stake cap must be at least 1 point.")
    .max(100_000),
});

export const joinLeagueSchema = z.object({
  code: z.string().trim().min(4, "Enter the invite code.").max(16),
});

export const createSeasonSchema = z
  .object({
    name: z.string().trim().max(60).optional(),
    startsAt: localDateTimeSchema,
    endsAt: localDateTimeSchema,
  })
  .refine(
    (value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(),
    { message: "The season must end after it starts.", path: ["endsAt"] },
  );

export const setLeagueRoleSchema = z.object({
  leagueId: z.string().cuid(),
  userId: z.string().cuid(),
  role: z.enum(["MOD", "MEMBER"]),
});

// --- Phase 3b: admin item authoring ---

export const itemSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Slug needs at least 3 characters.")
  .max(40, "Slug maxes out at 40 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers, and hyphens only — no leading or trailing hyphen.");

export const itemFormSchema = z.object({
  slug: itemSlugSchema,
  name: z.string().trim().min(2, "Name needs at least 2 characters.").max(40),
  description: z.string().trim().min(1, "Give it a one-liner.").max(200),
  kind: z.nativeEnum(ItemKind),
  // blank = not purchasable (earned only)
  storeCost: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.coerce.number().int("Whole gems only.").min(1).max(1_000_000).nullable()),
  active: z.coerce.boolean(),
  // the compiled style Json as a string; the action re-validates it against
  // the kind's cosmetics schema so unrenderable style can never persist
  style: z.string().trim().min(2, "Style is required."),
});

export const grantItemAdminSchema = z.object({
  itemId: z.string().cuid(),
  userId: z.string().cuid(),
});
