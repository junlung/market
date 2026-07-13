import { NextResponse } from "next/server";
import { evaluateAchievementsForRecentMarkets } from "@/lib/server/achievement-service";
import { finalizeDueSeasons } from "@/lib/server/season-service";

export const dynamic = "force-dynamic";

/**
 * Daily season housekeeping, invoked by the Vercel cron (see vercel.ts):
 * finalizes any season whose window ended — freezes standings, grants the
 * placement trophies and gems — and rolls the Global League into the current
 * month. Also re-runs the achievement checker over recently resolved markets,
 * closing the crash window between a settlement commit and its post-commit
 * achievement pass. Idempotent, so the daily schedule needs no month-boundary
 * cleverness.
 *
 * Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the env var is
 * set; anything else (including a missing secret) is rejected so the route
 * can't be triggered by strangers.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const finalized = await finalizeDueSeasons(new Date());
  const achievementSweep = await evaluateAchievementsForRecentMarkets();
  return NextResponse.json({ ok: true, finalized, achievementSweep });
}
