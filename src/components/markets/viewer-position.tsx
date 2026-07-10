import { estimatePayout } from "@/lib/parimutuel";
import { formatPoints, formatSignedPoints } from "@/lib/format";

/**
 * The viewer's stake with what it would pay if the market settled on the
 * current pools — the honest "where do I stand right now" card.
 */
export function ViewerPositionCard({
  yesStake,
  noStake,
  yesPool,
  noPool,
  rakeBps,
}: {
  yesStake: number;
  noStake: number;
  yesPool: number;
  noPool: number;
  rakeBps: number;
}) {
  const yesPays =
    yesStake > 0 ? estimatePayout({ stake: yesStake, winningPool: yesPool, losingPool: noPool, rakeBps }) : 0;
  const noPays =
    noStake > 0 ? estimatePayout({ stake: noStake, winningPool: noPool, losingPool: yesPool, rakeBps }) : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">Your position</p>
      <div className="mt-2 space-y-2.5">
        {yesStake > 0 ? (
          <div className="tabular-nums">
            <p className="flex justify-between">
              <span className="font-semibold text-yes">YES</span>
              <span>{formatPoints(yesStake)} pts in</span>
            </p>
            <p className="mt-0.5 flex justify-between text-xs text-muted">
              <span>pays if YES wins</span>
              <span>
                {formatPoints(yesPays)} pts{" "}
                <span className={yesPays - yesStake >= 0 ? "text-yes" : "text-no"}>
                  ({formatSignedPoints(yesPays - yesStake)})
                </span>
              </span>
            </p>
          </div>
        ) : null}
        {noStake > 0 ? (
          <div className="tabular-nums">
            <p className="flex justify-between">
              <span className="font-semibold text-no">NO</span>
              <span>{formatPoints(noStake)} pts in</span>
            </p>
            <p className="mt-0.5 flex justify-between text-xs text-muted">
              <span>pays if NO wins</span>
              <span>
                {formatPoints(noPays)} pts{" "}
                <span className={noPays - noStake >= 0 ? "text-yes" : "text-no"}>
                  ({formatSignedPoints(noPays - noStake)})
                </span>
              </span>
            </p>
          </div>
        ) : null}
      </div>
      <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-faint">
        Based on the pools right now — the real number is whatever they are at close.
      </p>
    </div>
  );
}
