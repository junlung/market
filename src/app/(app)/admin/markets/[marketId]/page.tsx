import { LocalTime } from "@/components/ui/local-time";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import clsx from "clsx";
import { marketStatusAction, updateMarketAction } from "@/app/actions/markets";
import { MarketForm } from "@/components/admin/market-form";
import { ProposalReview } from "@/components/admin/proposal-review";
import { ResolveMarketForm, type SettlementPreview } from "@/components/admin/resolve-market-form";
import { OutcomeDot } from "@/components/markets/outcome-dot";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClasses } from "@/components/ui/button";
import { formatChance, formatPoints, formatSignedPoints } from "@/lib/format";
import { outcomeDisplayLabel } from "@/lib/outcome-colors";
import { isMarketEditable } from "@/lib/markets";
import { getAdminMarketDetail, previewSettlement } from "@/lib/server/market-service";
import { requireAdminSession } from "@/lib/session";

type Props = {
  params: Promise<{ marketId: string }>;
};

export default async function AdminMarketDetailPage({ params }: Props) {
  await requireAdminSession();
  const { marketId } = await params;
  const market = await getAdminMarketDetail(marketId);

  if (!market) {
    notFound();
  }

  const editable = isMarketEditable(market);
  const resolvable = market.status === MarketStatus.OPEN || market.status === MarketStatus.CLOSED;

  let previews: SettlementPreview[] = [];
  if (resolvable) {
    previews = await Promise.all(
      market.outcomes.map(async (outcome) => {
        const preview = await previewSettlement(market.id, outcome.id);
        return {
          outcomeId: outcome.id,
          rows: preview.rows,
          rake: preview.rake,
          dust: preview.dust,
          mode: preview.mode,
        };
      }),
    );
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title={market.title}
        description={market.description}
        actions={
          <Link href={`/markets/${market.id}`} className={buttonClasses("secondary", "sm")}>
            View public page
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={market.status.toLowerCase()} />
        {market.status === MarketStatus.CANCELED ? (
          <StatusBadge label="refunded" />
        ) : market.winningOutcome ? (
          <StatusBadge label={`won: ${outcomeDisplayLabel(market.winningOutcome)}`} />
        ) : null}
        <span className="text-xs text-faint">{market.category}</span>
        {market.reviewNote ? (
          <span className="text-xs text-muted">Review note: {market.reviewNote}</span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Leading"
          value={
            market.leaderTied
              ? `${formatChance(market.leader.probability)} even`
              : `${formatChance(market.leader.probability)} ${outcomeDisplayLabel(market.leader)}`
          }
        />
        <StatCard
          label="Pot"
          value={`${formatPoints(market.pot)} pts`}
          hint={`${market.outcomes.length} outcomes`}
        />
        <StatCard label="Closes" value={<LocalTime date={market.closeTime} />} />
        <StatCard label="Resolves" value={<LocalTime date={market.resolveTime} />} />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold">Pools</h2>
        <div className="mt-3 space-y-1.5 text-sm">
          {market.outcomes.map((outcome) => (
            <p key={outcome.id} className="flex items-center justify-between gap-2 tabular-nums">
              <span className="flex min-w-0 items-center gap-2">
                <OutcomeDot color={outcome.color} />
                <span className="truncate font-medium">{outcomeDisplayLabel(outcome)}</span>
                {market.winningOutcomeId === outcome.id ? (
                  <span className="text-xs font-semibold text-yes">winner</span>
                ) : null}
              </span>
              <span className="shrink-0 text-muted">{formatPoints(outcome.pool)} pts</span>
            </p>
          ))}
        </div>
      </div>

      {market.status === MarketStatus.PROPOSED ? (
        <div className="rounded-xl border border-primary/30 bg-surface p-4">
          <p className="mb-3 text-sm font-semibold">Proposal review</p>
          <ProposalReview marketId={market.id} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {market.status === MarketStatus.DRAFT ? (
          <form action={marketStatusAction}>
            <input type="hidden" name="marketId" value={market.id} />
            <input type="hidden" name="action" value="open" />
            <button type="submit" className={buttonClasses("yes", "md")}>
              Open market
            </button>
          </form>
        ) : null}
        {market.status === MarketStatus.OPEN ? (
          <form action={marketStatusAction}>
            <input type="hidden" name="marketId" value={market.id} />
            <input type="hidden" name="action" value="close" />
            <button type="submit" className={buttonClasses("secondary", "md")}>
              Close betting
            </button>
          </form>
        ) : null}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          {editable ? (
            <MarketForm
              action={updateMarketAction}
              mode="admin"
              market={{
                id: market.id,
                title: market.title,
                description: market.description,
                category: market.category,
                closeTime: market.closeTime,
                resolveTime: market.resolveTime,
                resolutionSource: market.resolutionSource,
                outcomes: market.outcomes.map((outcome) => ({
                  label: outcome.label,
                  color: outcome.color,
                  emoji: outcome.emoji,
                })),
                maxStakePerUser: market.maxStakePerUser,
                rakeBps: market.rakeBps,
              }}
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
              Editing locks once the first bet lands. Lifecycle controls stay available.
            </div>
          )}

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Stakes</h2>
            {market.stakeRows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No stakes yet.</p>
            ) : (
              <div className="mt-3 divide-y divide-border">
                {market.stakeRows.map((row) => (
                  <div key={row.userId} className="flex items-center justify-between gap-4 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="truncate text-xs text-faint">{row.email}</p>
                    </div>
                    <div className="shrink-0 space-y-0.5 text-right text-xs tabular-nums">
                      {row.stakes
                        .filter((stake) => stake.amount > 0)
                        .map((stake) => (
                          <p key={stake.outcomeId} className="flex items-center justify-end gap-1.5">
                            <OutcomeDot color={stake.color} />
                            {outcomeDisplayLabel(stake)} {formatPoints(stake.amount)}
                          </p>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {market.resolution ? (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm">
              <h2 className="text-sm font-semibold">Settlement audit</h2>
              <dl className="mt-2 space-y-1 text-xs tabular-nums">
                {market.outcomes.map((outcome) => (
                  <div key={outcome.id} className="flex justify-between">
                    <dt className="flex items-center gap-1.5 text-muted">
                      <OutcomeDot color={outcome.color} />
                      Final pool — {outcomeDisplayLabel(outcome)}
                    </dt>
                    <dd>{formatPoints(outcome.poolFinal ?? outcome.pool)}</dd>
                  </div>
                ))}
                <div className="flex justify-between">
                  <dt className="text-muted">Paid out</dt>
                  <dd>{formatPoints(market.resolution.totalPaidOut)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Rake burned</dt>
                  <dd>{formatPoints(market.resolution.rakeAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Dust burned</dt>
                  <dd>{formatPoints(market.resolution.dustAmount)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-1 font-medium">
                  <dt>Conservation</dt>
                  <dd>
                    {market.outcomes.reduce((sum, outcome) => sum + (outcome.poolFinal ?? 0), 0) ===
                    market.resolution.totalPaidOut +
                      market.resolution.rakeAmount +
                      market.resolution.dustAmount
                      ? "✓ exact"
                      : "✗ MISMATCH"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          {market.settlementRows.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                    <th className="px-4 py-2.5 font-medium">Player</th>
                    <th className="px-4 py-2.5 font-medium">Position</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                    <th className="px-4 py-2.5 text-right font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {market.settlementRows.map((row) => (
                    <tr key={row.userId}>
                      <td className="px-4 py-2.5 font-medium">{row.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
                          {row.stakes
                            .filter((stake) => stake.amount > 0)
                            .map((stake) => (
                              <span key={stake.outcomeId} className="inline-flex items-center gap-1.5">
                                <OutcomeDot color={stake.color} />
                                {formatPoints(stake.amount)} on {outcomeDisplayLabel(stake)}
                              </span>
                            ))}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatPoints(row.settlementAmount)}
                      </td>
                      <td
                        className={clsx(
                          "px-4 py-2.5 text-right font-semibold tabular-nums",
                          row.profit > 0 ? "text-yes" : row.profit < 0 ? "text-no" : "text-muted",
                        )}
                      >
                        {formatSignedPoints(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          {resolvable ? (
            <ResolveMarketForm
              marketId={market.id}
              resolutionSource={market.resolutionSource}
              outcomes={market.outcomes.map((outcome) => ({
                id: outcome.id,
                label: outcome.label,
                color: outcome.color,
                emoji: outcome.emoji,
                pool: outcome.pool,
              }))}
              previews={previews}
            />
          ) : null}

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Audit trail</h2>
            <div className="mt-3 space-y-2">
              {market.appLogs.length === 0 ? (
                <p className="text-sm text-muted">No log entries.</p>
              ) : (
                market.appLogs.map((log) => (
                  <div key={log.id} className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                    <p className="font-medium">{log.message}</p>
                    <p className="mt-0.5 text-faint"><LocalTime date={log.createdAt} /></p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
