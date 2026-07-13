/**
 * One-time Phase 3 launch backfill runner. Safe to re-run — see
 * src/lib/server/backfill-gems.ts for the idempotency guarantees.
 *
 * Run against production after the Phase 3a deploy:
 *
 *   DATABASE_URL="<prod url>" npm run backfill-gems
 */
import { prisma } from "../src/lib/prisma";
import { runGemBackfill } from "../src/lib/server/backfill-gems";

runGemBackfill()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
