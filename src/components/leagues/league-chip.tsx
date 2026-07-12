import Link from "next/link";
import type { Route } from "next";

/**
 * Small pill marking content that belongs to a custom league, linking to the
 * league. Global-league content renders nothing — it's the default context.
 */
export function LeagueChip({ league }: { league: { slug: string; name: string; isGlobal: boolean } }) {
  if (league.isGlobal) {
    return null;
  }
  return (
    <Link
      href={`/l/${league.slug}` as Route}
      className="relative z-10 inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
    >
      {league.name}
    </Link>
  );
}
