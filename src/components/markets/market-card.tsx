import Link from "next/link";
import { Trophy, Users } from "lucide-react";
import { formatChance, formatCompactPoints, formatPoints } from "@/lib/format";
import { isYesNoMarket, outcomeColorBg, outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";
import { CountdownBadge } from "@/components/ui/countdown-badge";
import { PoolBar } from "@/components/ui/pool-bar";
import { ProbabilityChip } from "@/components/ui/probability-chip";
import { Sparkline } from "@/components/ui/sparkline";
import { OutcomeDot } from "@/components/markets/outcome-dot";

export type MarketCardOutcome = {
  id: string;
  label: string;
  color: string;
  emoji?: string | null;
  pool: number;
  probability: number;
};

export type MarketCardData = {
  id: string;
  title: string;
  category: string;
  closeTime: Date;
  outcomes: MarketCardOutcome[];
  leader: MarketCardOutcome;
  pot: number;
  participants: number;
  sparkPoints: number[];
  viewerStakes: Array<{ outcomeId: string; label: string; amount: number }>;
};

const TOP_OUTCOMES_SHOWN = 3;

export function MarketCard({ market }: { market: MarketCardData }) {
  const classic = isYesNoMarket(market.outcomes);

  const stakeLabel = market.viewerStakes
    .map((stake) => `${formatPoints(stake.amount)} on ${stake.label}`)
    .join(" · ");

  const topOutcomes = [...market.outcomes]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, TOP_OUTCOMES_SHOWN);
  const hiddenCount = market.outcomes.length - topOutcomes.length;

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
        {classic ? (
          <ProbabilityChip probability={market.outcomes[0].probability} size="lg" showLabel />
        ) : (
          <ProbabilityChip
            probability={market.leader.probability}
            color={market.leader.color}
            label={outcomeDisplayLabel(market.leader)}
            size="lg"
            showLabel
          />
        )}
      </div>

      {classic ? (
        <PoolBar outcomes={market.outcomes} className="mt-3" />
      ) : (
        <div className="mt-3 space-y-1.5">
          {topOutcomes.map((outcome) => (
            <Link
              key={outcome.id}
              href={`/markets/${market.id}?outcome=${outcome.id}`}
              className="relative z-10 flex items-center gap-2 text-xs"
            >
              <OutcomeDot color={outcome.color} />
              <span className="w-24 truncate font-medium">{outcomeDisplayLabel(outcome)}</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(outcome.probability * 100, 2)}%`,
                    background: outcomeColorVar(outcome.color),
                  }}
                />
              </span>
              <span className="w-9 text-right font-semibold tabular-nums">
                {formatChance(outcome.probability)}
              </span>
            </Link>
          ))}
          {hiddenCount > 0 ? (
            <p className="pl-4 text-[11px] text-faint">
              +{hiddenCount} more outcome{hiddenCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Trophy className="size-3.5 text-warn" aria-hidden />
          {formatCompactPoints(market.pot)} pot
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Users className="size-3.5" aria-hidden />
          {market.participants}
        </span>
        <Sparkline
          points={market.sparkPoints}
          color={classic ? undefined : market.leader.color}
        />
        {classic ? (
          <span className="relative z-10 flex gap-1.5">
            {market.outcomes.map((outcome) => (
              <Link
                key={outcome.id}
                href={`/markets/${market.id}?outcome=${outcome.id}`}
                className="rounded-md px-2.5 py-1 text-xs font-bold transition-colors hover:text-white"
                style={{
                  background: outcomeColorBg(outcome.color),
                  color: outcomeColorVar(outcome.color),
                }}
              >
                {outcomeDisplayLabel(outcome)}
              </Link>
            ))}
          </span>
        ) : null}
      </div>

      {stakeLabel ? (
        <div className="mt-3 border-t border-border pt-2 text-xs font-medium text-muted">
          You: {stakeLabel}
        </div>
      ) : null}
    </div>
  );
}
