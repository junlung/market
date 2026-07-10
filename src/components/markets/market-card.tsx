import Link from "next/link";
import { Trophy, Users } from "lucide-react";
import { formatCompactPoints, formatPoints } from "@/lib/format";
import { CountdownBadge } from "@/components/ui/countdown-badge";
import { PoolBar } from "@/components/ui/pool-bar";
import { ProbabilityChip } from "@/components/ui/probability-chip";
import { Sparkline } from "@/components/ui/sparkline";

export type MarketCardData = {
  id: string;
  title: string;
  category: string;
  closeTime: Date;
  yesPool: number;
  noPool: number;
  yesProbability: number;
  pot: number;
  participants: number;
  sparkPoints: number[];
  viewerStake: { yesStake: number; noStake: number } | null;
};

export function MarketCard({ market }: { market: MarketCardData }) {
  const stake = market.viewerStake;
  const stakeLabel =
    stake &&
    [
      stake.yesStake > 0 ? `${formatPoints(stake.yesStake)} on YES` : null,
      stake.noStake > 0 ? `${formatPoints(stake.noStake)} on NO` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-all hover:border-border-strong hover:shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
          {market.category}
        </span>
        <CountdownBadge closeTime={market.closeTime} />
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <Link href={`/markets/${market.id}`} className="min-w-0 flex-1">
          <span className="absolute inset-0" aria-hidden />
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug group-hover:text-primary">
            {market.title}
          </h3>
        </Link>
        <ProbabilityChip probability={market.yesProbability} size="lg" showLabel />
      </div>

      <PoolBar yesPool={market.yesPool} noPool={market.noPool} className="mt-3" />

      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Trophy className="size-3.5 text-warn" aria-hidden />
          {formatCompactPoints(market.pot)} pot
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Users className="size-3.5" aria-hidden />
          {market.participants}
        </span>
        <Sparkline points={market.sparkPoints} />
        <span className="relative z-10 flex gap-1.5">
          <Link
            href={`/markets/${market.id}?side=YES`}
            className="rounded-md bg-yes-bg px-2.5 py-1 text-xs font-bold text-yes transition-colors hover:bg-yes hover:text-white"
          >
            Yes
          </Link>
          <Link
            href={`/markets/${market.id}?side=NO`}
            className="rounded-md bg-no-bg px-2.5 py-1 text-xs font-bold text-no transition-colors hover:bg-no hover:text-white"
          >
            No
          </Link>
        </span>
      </div>

      {stakeLabel ? (
        <div className="mt-3 border-t border-border pt-2 text-xs font-medium text-muted">
          You: {stakeLabel}
        </div>
      ) : null}
    </div>
  );
}
