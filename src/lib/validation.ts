import { z } from "zod";
import { appConfig } from "@/lib/config";

const localDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid datetime");

const points = z.coerce.number().int("Whole points only.").min(1);

const marketFieldsSchema = z.object({
  title: z.string().trim().min(5, "Question needs at least 5 characters."),
  description: z.string().trim().min(10, "Description needs at least 10 characters — spell out what counts as YES."),
  category: z.string().trim().min(2, "Category needs at least 2 characters."),
  closeTime: localDateTimeSchema,
  resolveTime: localDateTimeSchema,
  resolutionSource: z.string().trim().min(5, "Resolution source needs at least 5 characters."),
});

/** First validation problem as a human-readable message for form errors. */
export function describeValidationError(error: z.ZodError, fallback: string) {
  return error.issues[0]?.message ?? fallback;
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
  outcome: z.enum(["YES", "NO"]),
  resolutionSource: z.string().trim().min(5).max(280),
  notes: z.string().trim().max(500).optional(),
});

export const cancelMarketSchema = z.object({
  marketId: z.string().cuid(),
  reason: z.string().trim().min(5).max(280),
});

export const betSchema = z.object({
  marketId: z.string().cuid(),
  side: z.enum(["YES", "NO"]),
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
  reason: z.string().trim().min(3).max(280),
});
