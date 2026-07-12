import { NextResponse } from "next/server";
import { finalizeDueSeasons } from "@/lib/server/season-service";

export const dynamic = "force-dynamic";

/**
 * Daily season housekeeping, invoked by the Vercel cron (see vercel.ts):
 * finalizes any season whose window ended — freezes standings, grants the
 * placement trophies — and rolls the Global League into the current month.
 * Idempotent, so the daily schedule needs no month-boundary cleverness.
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
  return NextResponse.json({ ok: true, finalized });
}
