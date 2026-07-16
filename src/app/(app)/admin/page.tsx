import Link from "next/link";
import type { Route } from "next";
import { MarketStatus } from "@prisma/client";
import clsx from "clsx";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button";
import { getUnresolvedFeedbackCount } from "@/lib/server/feedback-service";
import { getAdminMarkets } from "@/lib/server/market-service";
import { getUserStatusCounts } from "@/lib/server/member-service";
import { requireAdminSession } from "@/lib/session";

export default async function AdminPage() {
  await requireAdminSession();
  const [markets, memberCounts, unresolvedFeedback] = await Promise.all([
    getAdminMarkets(),
    getUserStatusCounts(),
    getUnresolvedFeedbackCount(),
  ]);

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

  const attention: Array<{ label: string; count: number; href: Route; zero: string }> = [
    { label: "Members pending", count: memberCounts.pending, href: "/admin/members" as Route, zero: "queue's clear" },
    { label: "Proposals pending", count: proposals, href: "/admin/markets?status=PROPOSED" as Route, zero: "none waiting" },
    { label: "Awaiting resolution", count: awaitingResolution, href: "/admin/markets?status=CLOSED" as Route, zero: "all settled" },
    { label: "Feedback unresolved", count: unresolvedFeedback, href: "/admin/feedback" as Route, zero: "inbox zero" },
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

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">Needs attention</h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-surface">
          {attention.map((row) => (
            <Link
              key={row.label}
              href={row.href}
              className="flex items-center gap-3 p-3 transition-colors hover:bg-surface-2"
            >
              <span
                className={clsx(
                  "min-w-7 rounded-full px-2 py-0.5 text-center text-sm font-bold tabular-nums",
                  row.count > 0 ? "bg-no/10 text-no" : "bg-surface-2 text-faint",
                )}
              >
                {row.count}
              </span>
              <span className="flex-1 text-sm font-medium">{row.label}</span>
              {row.count > 0 ? (
                <span className="text-xs font-medium text-primary">Review →</span>
              ) : (
                <span className="text-xs text-faint">{row.zero}</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted tabular-nums">
        <span>
          <span className="font-semibold text-foreground">{memberCounts.active}</span> active members
        </span>
        <span>
          <span className="font-semibold text-foreground">{open}</span> open markets
        </span>
        <span>
          <span className="font-semibold text-foreground">{closingSoon}</span> closing in 24h
        </span>
      </p>
    </section>
  );
}
