import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import clsx from "clsx";
import { marketStatusAction, updateMarketAction } from "@/app/actions/markets";
import { MarketForm } from "@/components/admin/market-form";
import { ProposalReview } from "@/components/admin/proposal-review";
import { ResolveMarketForm, type SettlementPreview } from "@/components/admin/resolve-market-form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClasses } from "@/components/ui/button";
import { formatChance, formatDateTime, formatPoints, formatSignedPoints } from "@/lib/format";
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
    const [yes, no] = await Promise.all([
      previewSettlement(market.id, "YES"),
      previewSettlement(market.id, "NO"),
    ]);
    previews = [
      { outcome: "YES", rows: yes.rows, rake: yes.rake, dust: yes.dust },
      { outcome: "NO", rows: no.rows, rake: no.rake, dust: no.dust },
    ];
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
        {market.finalOutcome ? <StatusBadge label={market.finalOutcome.toLowerCase()} /> : null}
        <span className="text-xs text-faint">{market.category}</span>
        {market.reviewNote ? (
          <span className="text-xs text-muted">Review note: {market.reviewNote}</span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Implied chance" value={`${formatChance(market.yesProbability)} yes`} />
        <StatCard
          label="Pools"
          value={`${formatPoints(market.yesPool)} / ${formatPoints(market.noPool)}`}
          hint="Yes / No points"
        />
        <StatCard label="Closes" value={formatDateTime(market.closeTime)} />
        <StatCard label="Resolves" value={formatDateTime(market.resolveTime)} />
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
            {market.poolStakes.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No stakes yet.</p>
            ) : (
              <div className="mt-3 divide-y divide-border">
                {market.poolStakes.map((stake) => (
                  <div key={stake.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium">{stake.user.name}</p>
                      <p className="text-xs text-faint">{stake.user.email}</p>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <p className="text-yes">YES {formatPoints(stake.yesStake)}</p>
                      <p className="text-no">NO {formatPoints(stake.noStake)}</p>
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
                <div className="flex justify-between">
                  <dt className="text-muted">Final pools (yes/no)</dt>
                  <dd>
                    {formatPoints(market.resolution.yesPoolFinal)} /{" "}
                    {formatPoints(market.resolution.noPoolFinal)}
                  </dd>
                </div>
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
                    {market.resolution.yesPoolFinal + market.resolution.noPoolFinal ===
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
                    <th className="px-4 py-2.5 text-right font-medium">Yes</th>
                    <th className="px-4 py-2.5 text-right font-medium">No</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                    <th className="px-4 py-2.5 text-right font-medium">P/L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {market.settlementRows.map((row) => (
                    <tr key={row.userId}>
                      <td className="px-4 py-2.5 font-medium">{row.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatPoints(row.yesStake)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatPoints(row.noStake)}</td>
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
                    <p className="mt-0.5 text-faint">{formatDateTime(log.createdAt)}</p>
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
