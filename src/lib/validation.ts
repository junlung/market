import { z } from "zod";
import { appConfig } from "@/lib/config";
import { graphemeCount } from "@/lib/outcome-colors";

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
