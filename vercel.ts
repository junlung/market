import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    // Season housekeeping (docs/social-features-plan.md, Phase 2a): finalize
    // ended seasons (freeze standings, grant trophies) and open the current
    // month's. Daily because the handler is idempotent — 364 runs no-op and
    // the month-boundary run does the work. Requires CRON_SECRET in env.
    { path: "/api/cron/finalize-seasons", schedule: "5 0 * * *" },
  ],
};
