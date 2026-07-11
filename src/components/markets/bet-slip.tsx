"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { placeBetAction, type PlaceBetActionResult } from "@/app/actions/markets";
import { appConfig } from "@/lib/config";
import { formatChance, formatPoints, formatSignedPoints } from "@/lib/format";
import { estimatePayout } from "@/lib/parimutuel";
import { outcomeColorBg, outcomeColorVar, outcomeDisplayLabel } from "@/lib/outcome-colors";
import { useToast } from "@/components/ui/toast";

const CHIPS = [10, 50, 100];

export type BetSlipOutcome = {
  id: string;
  label: string;
  color: string;
  emoji?: string | null;
  pool: number;
};

type Props = {
  marketId: string;
  outcomes: BetSlipOutcome[];
  rakeBps: number;
  maxStakePerUser: number;
  balance: number;
  viewerStakeTotal: number;
  initialOutcomeId?: string;
};

export function BetSlip({
  marketId,
  outcomes,
  rakeBps,
  maxStakePerUser,
  balance: initialBalance,
  viewerStakeTotal: initialStakeTotal,
  initialOutcomeId,
}: Props) {
  const toast = useToast();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(
    outcomes.some((outcome) => outcome.id === initialOutcomeId)
      ? initialOutcomeId!
      : outcomes[0].id,
  );
  const [amount, setAmount] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // pools update instantly from the action result; the RSC refresh follows
  const [pools, setPools] = useState<Map<string, number>>(
    () => new Map(outcomes.map((outcome) => [outcome.id, outcome.pool])),
  );
  const [stakeTotal, setStakeTotal] = useState(initialStakeTotal);
  const [spent, setSpent] = useState(0);

  const poolsProp = outcomes.map((outcome) => outcome.pool).join(",");
  useEffect(() => {
    setPools(new Map(outcomes.map((outcome) => [outcome.id, outcome.pool])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolsProp]);
  useEffect(() => setStakeTotal(initialStakeTotal), [initialStakeTotal]);

  // invoked imperatively rather than through useActionState: in production
  // builds, an action that revalidates the current page resets action state
  // before the success ever renders, eating the toast — the awaited result
  // in this closure survives any re-render
  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result: PlaceBetActionResult = await placeBetAction({}, formData);
      if (result.success) {
        toast.success(result.success);
        if (result.pools) {
          setPools(new Map(result.pools.map((entry) => [entry.outcomeId, entry.pool])));
        }
        if (result.stakeTotal !== undefined) {
          setSpent((current) => current + (result.stakeTotal! - stakeTotal));
          setStakeTotal(result.stakeTotal);
        }
        setAmount("");
        router.refresh();
      } else if (result.error) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  const balance = initialBalance - spent;
  const capRemaining = Math.max(maxStakePerUser - stakeTotal, 0);
  const maxAmount = Math.min(balance, capRemaining, appConfig.maxBetAmount);

  const parsedAmount = Number.parseInt(amount, 10);
  const validAmount = Number.isInteger(parsedAmount) && parsedAmount >= 1 && parsedAmount <= maxAmount;

  const total = [...pools.values()].reduce((sum, pool) => sum + pool, 0);
  const selected = outcomes.find((outcome) => outcome.id === selectedId)!;
  const selectedPool = pools.get(selectedId) ?? 0;
  const probabilityOf = (outcomeId: string) =>
    total > 0 ? (pools.get(outcomeId) ?? 0) / total : 1 / outcomes.length;

  const preview = useMemo(() => {
    if (!validAmount) {
      return null;
    }
    const winningPool = selectedPool + parsedAmount;
    const losingPool = total - selectedPool;
    try {
      const payout = estimatePayout({ stake: parsedAmount, winningPool, losingPool, rakeBps });
      const newTotal = total + parsedAmount;
      return {
        payout,
        profit: payout - parsedAmount,
        probabilityAfter: newTotal > 0 ? winningPool / newTotal : 1 / outcomes.length,
      };
    } catch {
      return null;
    }
  }, [validAmount, parsedAmount, selectedPool, total, rakeBps, outcomes.length]);

  const isBinary = outcomes.length === 2;
  // when a market uses emojis, they get top billing: stacked above the label
  // on binary tiles, a large avatar slot on multi-outcome rows
  const hasEmojis = outcomes.some((outcome) => outcome.emoji?.trim());

  const outcomeButton = (outcome: BetSlipOutcome) => {
    const active = selectedId === outcome.id;
    const colorStyle = active
      ? { background: outcomeColorVar(outcome.color) }
      : { background: outcomeColorBg(outcome.color), color: outcomeColorVar(outcome.color) };
    const emoji = outcome.emoji?.trim();

    if (isBinary && hasEmojis) {
      return (
        <button
          key={outcome.id}
          type="button"
          onClick={() => setSelectedId(outcome.id)}
          aria-pressed={active}
          className={clsx(
            "flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-sm font-bold transition-colors",
            active ? "text-white" : "hover:brightness-95",
          )}
          style={colorStyle}
        >
          <span aria-hidden className="text-2xl leading-none">
            {emoji || "•"}
          </span>
          <span className="flex max-w-full items-baseline gap-1.5">
            <span className="truncate">{outcome.label}</span>
            <span className="font-semibold opacity-80 tabular-nums">
              {formatChance(probabilityOf(outcome.id))}
            </span>
          </span>
        </button>
      );
    }

    return (
      <button
        key={outcome.id}
        type="button"
        onClick={() => setSelectedId(outcome.id)}
        aria-pressed={active}
        className={clsx(
          "flex items-center rounded-lg px-3 text-sm font-bold transition-colors",
          hasEmojis ? "h-12" : "h-11",
          isBinary ? "flex-1 justify-center gap-1.5" : "w-full gap-2",
          active ? "text-white" : "hover:brightness-95",
        )}
        style={colorStyle}
      >
        {hasEmojis && !isBinary ? (
          <span aria-hidden className="w-8 shrink-0 text-center text-2xl leading-none">
            {emoji || "•"}
          </span>
        ) : null}
        <span className={clsx("truncate", !isBinary && "flex-1 text-left")}>{outcome.label}</span>
        <span className="font-semibold opacity-80 tabular-nums">
          {formatChance(probabilityOf(outcome.id))}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Place your bet</h2>
        <span className="text-xs text-muted tabular-nums">Balance: {formatPoints(balance)} pts</span>
      </div>

      <div className={clsx("mt-3", isBinary ? "flex gap-2" : "space-y-1.5")}>
        {outcomes.map(outcomeButton)}
      </div>

      <form action={submit} className="mt-3 space-y-3">
        <input type="hidden" name="marketId" value={marketId} />
        <input type="hidden" name="outcomeId" value={selectedId} />
        <input type="hidden" name="outcomeLabel" value={outcomeDisplayLabel(selected)} />

        <div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            name="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            aria-label="Points to bet"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-center text-2xl font-bold tabular-nums placeholder:text-faint focus:border-primary focus:bg-surface focus:outline-none"
          />
          <div className="mt-2 flex gap-1.5">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() =>
                  setAmount(String(Math.min((Number.parseInt(amount, 10) || 0) + chip, maxAmount)))
                }
                className="flex-1 rounded-md bg-surface-2 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-border hover:text-foreground"
              >
                +{chip}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(maxAmount))}
              className="flex-1 rounded-md bg-surface-2 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-border hover:text-foreground"
            >
              Max
            </button>
          </div>
        </div>

        {maxStakePerUser > 0 ? (
          <div>
            <div className="flex justify-between text-[11px] text-faint">
              <span>
                Staked {formatPoints(stakeTotal)} / {formatPoints(maxStakePerUser)} cap
              </span>
              <span className="tabular-nums">{formatPoints(capRemaining)} left</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min((stakeTotal / maxStakePerUser) * 100, 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        {preview ? (
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Est. payout if {selected.label} wins</span>
              <span className="font-bold tabular-nums">
                {formatPoints(preview.payout)} pts{" "}
                <span className={preview.profit >= 0 ? "text-yes" : "text-no"}>
                  ({formatSignedPoints(preview.profit)})
                </span>
              </span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-faint">
              <span>{selected.label} chance after your bet</span>
              <span className="tabular-nums">{formatChance(preview.probabilityAfter)}</span>
            </div>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!validAmount || pending}
          className="h-11 w-full rounded-lg text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: outcomeColorVar(selected.color) }}
        >
          {pending
            ? "Placing bet…"
            : validAmount
              ? `Bet ${formatPoints(parsedAmount)} pts on ${selected.label}`
              : `Bet on ${selected.label}`}
        </button>

        {error ? <p className="text-xs text-no">{error}</p> : null}

        <p className="text-[11px] leading-relaxed text-faint">
          Heads up: the payout above will drift as friends pile in — what you actually win depends on
          where the pools sit when betting closes. And once your points are in, they&apos;re in.
        </p>
      </form>
    </div>
  );
}
