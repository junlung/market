import Link from "next/link";
import type { Route } from "next";
import { MarketStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { buttonClasses } from "@/components/ui/button";
import { getAdminMarkets } from "@/lib/server/market-service";
import { getPendingUserCount } from "@/lib/server/member-service";
import { requireAdminSession } from "@/lib/session";

export default async function AdminPage() {
  await requireAdminSession();
  const [markets, pendingMembers] = await Promise.all([getAdminMarkets(), getPendingUserCount()]);

  const proposals = markets.filter((market) => market.status === MarketStatus.PROPOSED).length;
  const open = markets.filter((market) => market.status === MarketStatus.OPEN).length;
  const closingSoon = markets.filter(
    (market) =>
      market.status === MarketStatus.OPEN &&
      market.closeTime.getTime() - Date.now() < 24 * 60 * 60 * 1000 &&
      market.closeTime.getTime() > Date.now(),
  ).length;
  const awaitingResolution = markets.filter(
    (market) =>
      market.status === MarketStatus.CLOSED ||
      (market.status === MarketStatus.OPEN && market.closeTime <= new Date()),
  ).length;

  const tiles: Array<{ label: string; value: number; href: Route }> = [
    { label: "Members pending", value: pendingMembers, href: "/admin/members" as Route },
    { label: "Proposals pending", value: proposals, href: "/admin/markets?status=PROPOSED" as Route },
    { label: "Open markets", value: open, href: "/admin/markets?status=OPEN" as Route },
    { label: "Closing in 24h", value: closingSoon, href: "/admin/markets?status=OPEN" as Route },
    { label: "Awaiting resolution", value: awaitingResolution, href: "/admin/markets?status=CLOSED" as Route },
  ];

  return (
    <section className="space-y-5">
      <PageHeader
        title="League control center"
        description="Review proposals, run the market lifecycle, and settle outcomes."
        actions={
          <Link href="/admin/markets/new" className={buttonClasses("primary", "sm")}>
            New market
          </Link>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="transition-transform hover:-translate-y-0.5">
            <StatCard label={tile.label} value={String(tile.value)} />
          </Link>
        ))}
      </div>
      <Link href="/admin/markets" className={buttonClasses("secondary", "md")}>
        Manage all markets →
      </Link>
    </section>
  );
}
