"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { placeBetAction, type PlaceBetActionResult } from "@/app/actions/markets";
import { appConfig } from "@/lib/config";
import { formatChance, formatPoints, formatSignedPoints } from "@/lib/format";
import { estimatePayout } from "@/lib/parimutuel";
import { useToast } from "@/components/ui/toast";

const CHIPS = [10, 50, 100];

type Props = {
  marketId: string;
  yesPool: number;
  noPool: number;
  rakeBps: number;
  maxStakePerUser: number;
  balance: number;
  viewerStakeTotal: number;
  initialSide?: "YES" | "NO";
};

export function BetSlip({
  marketId,
  yesPool: initialYesPool,
  noPool: initialNoPool,
  rakeBps,
  maxStakePerUser,
  balance: initialBalance,
  viewerStakeTotal: initialStakeTotal,
  initialSide,
}: Props) {
  const toast = useToast();
  const [side, setSide] = useState<"YES" | "NO">(initialSide ?? "YES");
  const [amount, setAmount] = useState<string>("");
  const [state, formAction, pending] = useActionState<PlaceBetActionResult, FormData>(placeBetAction, {});

  // pools update instantly from the action result; the RSC refresh follows
  const [pools, setPools] = useState({ yesPool: initialYesPool, noPool: initialNoPool });
  const [stakeTotal, setStakeTotal] = useState(initialStakeTotal);
  const [spent, setSpent] = useState(0);
  const lastHandled = useRef<PlaceBetActionResult | null>(null);

  useEffect(() => {
    setPools({ yesPool: initialYesPool, noPool: initialNoPool });
  }, [initialYesPool, initialNoPool]);
  useEffect(() => setStakeTotal(initialStakeTotal), [initialStakeTotal]);

  useEffect(() => {
    if (state === lastHandled.current) {
      return;
    }
    lastHandled.current = state;

    if (state.success) {
      toast.success(state.success);
      if (state.yesPool !== undefined && state.noPool !== undefined) {
        setPools({ yesPool: state.yesPool, noPool: state.noPool });
      }
      if (state.stakeTotal !== undefined) {
        setSpent((current) => current + (state.stakeTotal! - stakeTotal));
        setStakeTotal(state.stakeTotal);
      }
      setAmount("");
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const balance = initialBalance - spent;
  const capRemaining = Math.max(maxStakePerUser - stakeTotal, 0);
  const maxAmount = Math.min(balance, capRemaining, appConfig.maxBetAmount);

  const parsedAmount = Number.parseInt(amount, 10);
  const validAmount = Number.isInteger(parsedAmount) && parsedAmount >= 1 && parsedAmount <= maxAmount;

  const total = pools.yesPool + pools.noPool;
  const yesProbability = total > 0 ? pools.yesPool / total : 0.5;

  const preview = useMemo(() => {
    if (!validAmount) {
      return null;
    }
    const winningPool = (side === "YES" ? pools.yesPool : pools.noPool) + parsedAmount;
    const losingPool = side === "YES" ? pools.noPool : pools.yesPool;
    try {
      const payout = estimatePayout({ stake: parsedAmount, winningPool, losingPool, rakeBps });
      const newTotal = total + parsedAmount;
      return {
        payout,
        profit: payout - parsedAmount,
        probabilityAfter: newTotal > 0 ? (side === "YES" ? winningPool / newTotal : 1 - winningPool / newTotal) : 0.5,
      };
    } catch {
      return null;
    }
  }, [validAmount, parsedAmount, side, pools, rakeBps, total]);

  const sideButton = (target: "YES" | "NO", probability: number) => (
    <button
      type="button"
      onClick={() => setSide(target)}
      aria-pressed={side === target}
      className={clsx(
        "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold transition-colors",
        side === target
          ? target === "YES"
            ? "bg-yes text-white"
            : "bg-no text-white"
          : target === "YES"
            ? "bg-yes-bg text-yes hover:brightness-95"
            : "bg-no-bg text-no hover:brightness-95",
      )}
    >
      {target === "YES" ? "Yes" : "No"}
      <span className="font-semibold opacity-80 tabular-nums">{formatChance(probability)}</span>
    </button>
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)] sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Place your bet</h2>
        <span className="text-xs text-muted tabular-nums">Balance: {formatPoints(balance)} pts</span>
      </div>

      <div className="mt-3 flex gap-2">
        {sideButton("YES", yesProbability)}
        {sideButton("NO", 1 - yesProbability)}
      </div>

      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="marketId" value={marketId} />
        <input type="hidden" name="side" value={side} />

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
              <span className="text-muted">Est. payout if {side} wins</span>
              <span className="font-bold tabular-nums">
                {formatPoints(preview.payout)} pts{" "}
                <span className={preview.profit >= 0 ? "text-yes" : "text-no"}>
                  ({formatSignedPoints(preview.profit)})
                </span>
              </span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-faint">
              <span>{side} chance after your bet</span>
              <span className="tabular-nums">{formatChance(preview.probabilityAfter)}</span>
            </div>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!validAmount || pending}
          className={clsx(
            "h-11 w-full rounded-lg text-sm font-bold text-white transition-all disabled:opacity-50",
            side === "YES" ? "bg-yes hover:brightness-110" : "bg-no hover:brightness-110",
          )}
        >
          {pending
            ? "Placing bet…"
            : validAmount
              ? `Bet ${formatPoints(parsedAmount)} pts on ${side}`
              : `Bet on ${side}`}
        </button>

        {state.error ? <p className="text-xs text-no">{state.error}</p> : null}

        <p className="text-[11px] leading-relaxed text-faint">
          Heads up: the payout above will drift as friends pile in — what you actually win depends on
          where the pools sit when betting closes. And once your points are in, they&apos;re in.
        </p>
      </form>
    </div>
  );
}
