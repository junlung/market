import clsx from "clsx";
import { Crown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatPoints, formatSignedPoints } from "@/lib/format";
import { getLeaderboard } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const session = await requireSession();
  const leaderboard = await getLeaderboard();
  const podium = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Leaderboard"
        description="Ranked by net profit — what you've made beyond what the house gave you. Settle it in the pools."
      />

      {leaderboard.length === 0 ? (
        <EmptyState icon={Crown} title="Nobody's here yet" description="Invite the group and let the games begin." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {podium.map((entry, index) => (
              <div
                key={entry.userId}
                className={clsx(
                  "flex flex-col items-center rounded-xl border bg-surface p-5 text-center",
                  index === 0 ? "border-warn/40 sm:order-2 sm:-mt-2" : "border-border",
                  index === 1 && "sm:order-1",
                  index === 2 && "sm:order-3",
                )}
              >
                <span className="text-2xl">{MEDALS[index]}</span>
                <Avatar name={entry.name} size="lg" className="mt-2" />
                <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                  {entry.name}
                  {entry.userId === session.user.id ? (
                    <span className="text-xs font-normal text-faint">(you)</span>
                  ) : null}
                </p>
                <p
                  className={clsx(
                    "mt-1 text-xl font-bold tabular-nums",
                    entry.netProfit > 0 ? "text-yes" : entry.netProfit < 0 ? "text-no" : "text-muted",
                  )}
                >
                  {formatSignedPoints(entry.netProfit)}
                </p>
                <p className="mt-0.5 text-xs text-muted tabular-nums">
                  {formatPoints(entry.portfolioValue)} pts total
                </p>
              </div>
            ))}
          </div>

          {rest.length > 0 || podium.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Player</th>
                    <th className="px-4 py-2.5 text-right font-medium">Net profit</th>
                    <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                    <th className="px-4 py-2.5 text-right font-medium">At stake</th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leaderboard.map((entry, index) => (
                    <tr
                      key={entry.userId}
                      className={clsx(
                        "transition-colors",
                        entry.userId === session.user.id ? "bg-primary/5" : "hover:bg-surface-2",
                      )}
                    >
                      <td className="px-4 py-2.5 font-semibold tabular-nums text-muted">{index + 1}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          <Avatar name={entry.name} size="xs" />
                          {entry.name}
                          {entry.userId === session.user.id ? (
                            <span className="text-xs text-faint">(you)</span>
                          ) : null}
                        </span>
                      </td>
                      <td
                        className={clsx(
                          "px-4 py-2.5 text-right font-bold tabular-nums",
                          entry.netProfit > 0 ? "text-yes" : entry.netProfit < 0 ? "text-no" : "text-muted",
                        )}
                      >
                        {formatSignedPoints(entry.netProfit)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatPoints(entry.balance)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                        {formatPoints(entry.atRisk)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {formatPoints(entry.portfolioValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
