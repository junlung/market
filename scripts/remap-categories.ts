/**
 * One-time Global League category remap runner. Dry-run by default; see
 * src/lib/server/remap-categories.ts for the plan format and idempotency
 * guarantees. Author the MAPPING there against prod's actual values first.
 *
 * Run against production after the categories deploy:
 *
 *   DATABASE_URL="<prod url>" npm run remap-categories            # dry run
 *   DATABASE_URL="<prod url>" npm run remap-categories -- --execute
 */
import { prisma } from "../src/lib/prisma";
import { runCategoryRemap } from "../src/lib/server/remap-categories";

runCategoryRemap({ execute: process.argv.includes("--execute") })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
