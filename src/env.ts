import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().url().optional(),
  // shared secret for Vercel cron invocations (api/cron/*) — the routes
  // reject every request when it's unset
  CRON_SECRET: z.string().min(16).optional(),
  SEED_DEFAULT_PASSWORD: z.string().min(8).optional(),
  STARTING_BALANCE: z.coerce.number().int().positive().default(500),
  WEEKLY_ALLOWANCE: z.coerce.number().int().positive().default(100),
  RAKE_BPS: z.coerce.number().int().min(0).max(2000).default(500),
  DEFAULT_MAX_STAKE_PER_USER: z.coerce.number().int().positive().default(500),
  MAX_BET_AMOUNT: z.coerce.number().int().positive().default(250),
  BET_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10000),
  BET_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(5),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  CRON_SECRET: process.env.CRON_SECRET,
  SEED_DEFAULT_PASSWORD: process.env.SEED_DEFAULT_PASSWORD,
  STARTING_BALANCE: process.env.STARTING_BALANCE,
  WEEKLY_ALLOWANCE: process.env.WEEKLY_ALLOWANCE,
  RAKE_BPS: process.env.RAKE_BPS,
  DEFAULT_MAX_STAKE_PER_USER: process.env.DEFAULT_MAX_STAKE_PER_USER,
  MAX_BET_AMOUNT: process.env.MAX_BET_AMOUNT,
  BET_RATE_LIMIT_WINDOW_MS: process.env.BET_RATE_LIMIT_WINDOW_MS,
  BET_RATE_LIMIT_MAX_REQUESTS: process.env.BET_RATE_LIMIT_MAX_REQUESTS,
});
