import { LocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import type { Route } from "next";
import { ReceiptText } from "lucide-react";
import { LeagueChip } from "@/components/leagues/league-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { OutcomeDot } from "@/components/markets/outcome-dot";
import { formatPoints } from "@/lib/format";
import { marketPath } from "@/lib/leagues";
import { outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";
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
                <th className="px-4 py-2.5 font-medium">Pick</th>
                <th className="px-4 py-2.5 text-right font-medium">Stake</th>
                <th className="px-4 py-2.5 text-right font-medium">Odds after</th>
                <th className="px-4 py-2.5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bets.map((bet) => (
                <tr key={bet.id} className="transition-colors hover:bg-surface-2">
                  <td className="max-w-64 px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Link
                        href={marketPath(bet.market.league, bet.market.id) as Route}
                        className="line-clamp-1 min-w-0 font-medium hover:text-primary"
                      >
                        {bet.market.title}
                      </Link>
                      <LeagueChip league={bet.market.league} />
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <OutcomeDot color={bet.outcome.color} />
                      <span
                        className="max-w-32 truncate font-bold"
                        style={{ color: outcomeColorVar(bet.outcome.color) }}
                      >
                        {outcomeDisplayLabel(bet.outcome)}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {formatPoints(bet.amount)} pts
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {bet.totalPoolAfter > 0
                      ? `${Math.round((bet.outcomePoolAfter / bet.totalPoolAfter) * 100)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted">
                    <LocalTime date={bet.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
