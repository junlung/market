import Link from "next/link";
import { ReceiptText } from "lucide-react";
import clsx from "clsx";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime, formatPoints } from "@/lib/format";
import { getBetHistory } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

export default async function HistoryPage() {
  const session = await requireSession();
  const bets = await getBetHistory(session.user.id);

  return (
    <section className="space-y-5">
      <PageHeader title="Bet history" description="Every bet you've placed, newest first." />

      {bets.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No bets yet"
          description="Your betting record starts with your first stake."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">Market</th>
                <th className="px-4 py-2.5 font-medium">Side</th>
                <th className="px-4 py-2.5 text-right font-medium">Stake</th>
                <th className="px-4 py-2.5 text-right font-medium">Yes odds after</th>
                <th className="px-4 py-2.5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bets.map((bet) => {
                const total = bet.yesPoolAfter + bet.noPoolAfter;
                return (
                  <tr key={bet.id} className="transition-colors hover:bg-surface-2">
                    <td className="max-w-64 px-4 py-2.5">
                      <Link
                        href={`/markets/${bet.market.id}`}
                        className="line-clamp-1 font-medium hover:text-primary"
                      >
                        {bet.market.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={clsx("font-bold", bet.side === "YES" ? "text-yes" : "text-no")}>
                        {bet.side}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatPoints(bet.amount)} pts
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                      {total > 0 ? `${Math.round((bet.yesPoolAfter / total) * 100)}%` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted">
                      {formatDateTime(bet.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
