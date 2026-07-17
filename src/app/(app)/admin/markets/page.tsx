import { LocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import type { Route } from "next";
import clsx from "clsx";
import { marketStatusAction } from "@/app/actions/markets";
import { ProposalReview } from "@/components/admin/proposal-review";
import { categoryDisplay } from "@/lib/categories";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClasses } from "@/components/ui/button";
import { formatChance, formatPoints } from "@/lib/format";
import { outcomeDisplayLabel } from "@/lib/outcome-colors";
import { getAdminMarkets } from "@/lib/server/market-service";
import { requireAdminSession } from "@/lib/session";

const STATUS_TABS: Array<{ id: string; label: string }> = [
  { id: "", label: "All" },
  { id: "PROPOSED", label: "Proposals" },
  { id: "DRAFT", label: "Draft" },
  { id: "OPEN", label: "Open" },
  { id: "CLOSED", label: "Closed" },
  { id: "RESOLVED", label: "Resolved" },
  { id: "CANCELED", label: "Canceled" },
  { id: "REJECTED", label: "Rejected" },
];

export default async function AdminMarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const { status } = await searchParams;
  const allMarkets = await getAdminMarkets();
  const markets = status ? allMarkets.filter((market) => market.status === status) : allMarkets;

  const countByStatus = new Map<string, number>();
  for (const market of allMarkets) {
    countByStatus.set(market.status, (countByStatus.get(market.status) ?? 0) + 1);
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Markets"
        description="Review, open, close, resolve, and audit every market."
        actions={
          <Link href="/admin/markets/new" className={buttonClasses("primary", "sm")}>
            New market
          </Link>
        }
      />

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {STATUS_TABS.map((tab) => {
          const count = tab.id ? (countByStatus.get(tab.id) ?? 0) : allMarkets.length;
          const selected = (status ?? "") === tab.id;
          return (
            <Link
              key={tab.id || "all"}
              href={(tab.id ? `/admin/markets?status=${tab.id}` : "/admin/markets") as Route}
              className={clsx(
                "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                selected ? "bg-foreground text-background" : "bg-surface-2 text-muted hover:text-foreground",
              )}
            >
              {tab.label} <span className="tabular-nums opacity-70">{count}</span>
            </Link>
          );
        })}
      </div>

      {markets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          No markets in this state.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-surface">
          {markets.map((market) => (
            <div key={market.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={market.status.toLowerCase()} />
                    <span className="text-xs text-faint">{categoryDisplay(market.category)}</span>
                  </div>
                  <Link
                    href={`/admin/markets/${market.id}`}
                    className="mt-1 block truncate text-sm font-semibold hover:text-primary"
                  >
                    {market.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted tabular-nums">
                    {formatChance(market.leader.probability)}{" "}
                    {market.leaderTied ? "even" : outcomeDisplayLabel(market.leader)} ·{" "}
                    {market.outcomes.length} outcomes · {formatPoints(market.pot)} pt pot ·{" "}
                    {market.betCount} bet{market.betCount === 1 ? "" : "s"} · closes{" "}
                    <LocalTime date={market.closeTime} />
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {market.status === "DRAFT" ? (
                    <form action={marketStatusAction}>
                      <input type="hidden" name="marketId" value={market.id} />
                      <input type="hidden" name="action" value="open" />
                      <button type="submit" className={buttonClasses("yes", "sm")}>
                        Open
                      </button>
                    </form>
                  ) : null}
                  {market.status === "OPEN" ? (
                    <form action={marketStatusAction}>
                      <input type="hidden" name="marketId" value={market.id} />
                      <input type="hidden" name="action" value="close" />
                      <button type="submit" className={buttonClasses("secondary", "sm")}>
                        Close
                      </button>
                    </form>
                  ) : null}
                  <Link href={`/admin/markets/${market.id}`} className={buttonClasses("ghost", "sm")}>
                    Manage
                  </Link>
                </div>
              </div>

              {market.status === "PROPOSED" ? (
                <div className="mt-3 rounded-lg bg-surface-2 p-3">
                  <ProposalReview marketId={market.id} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
