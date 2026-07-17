"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import type { ActionResult } from "@/lib/server/market-service";
import { BadgeGlyph } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProfileLink } from "@/components/members/profile-link";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import { formatPoints, formatSignedPoints } from "@/lib/format";
import { dateKeyToUtcIso, formatDateKey } from "@/lib/guess-dates";
import { RANK_MEDALS, type GuessMarketStatus, type TimelineGuess } from "./timeline-model";

/**
 * The strip under the track: claim/move form when a day is selected, the
 * tapped flag's details, otherwise a status line. One region, one purpose at
 * a time — and it lives outside the scroller so nothing ever clips.
 */
export function GuessClaimBar({
  marketId,
  ante,
  status,
  ownKey,
  selectedKey,
  inspected,
  viewerId,
  guesses,
  formAction,
  pending,
  state,
  onClear,
}: {
  marketId: string;
  ante: number;
  status: GuessMarketStatus;
  ownKey: string | null;
  selectedKey: string | null;
  inspected: TimelineGuess | null;
  viewerId: string;
  guesses: TimelineGuess[];
  formAction: (formData: FormData) => void;
  pending: boolean;
  state: ActionResult;
  onClear: () => void;
}) {
  const isOpen = status === "open";

  if (isOpen && selectedKey) {
    return (
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="marketId" value={marketId} />
        <input type="hidden" name="value" value={dateKeyToUtcIso(selectedKey)} />
        <p className="min-w-40 flex-1 text-sm">
          {ownKey ? (
            <>
              Move <span className="font-semibold">{formatDateKey(ownKey, "short")}</span> →{" "}
              <span className="font-semibold">{formatDateKey(selectedKey, "short")}</span>{" "}
              <span className="text-faint">· free until close</span>
            </>
          ) : (
            <>
              Plant your flag on{" "}
              <span className="font-semibold">{formatDateKey(selectedKey, "short")}</span>{" "}
              <span className="text-faint">· ante {formatPoints(ante)} pts</span>
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Claiming…" : ownKey ? "Move" : "Claim"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Cancel
          </Button>
        </div>
        {state.error ? (
          <div className="w-full">
            <FieldError message={state.error} />
          </div>
        ) : null}
      </form>
    );
  }

  if (inspected) {
    const isSelf = inspected.userId === viewerId;
    const net = (inspected.payout ?? 0) - ante;
    return (
      <div className="flex items-start justify-between gap-3" aria-live="polite">
        <div className="min-w-0">
          <ProfileLink
            username={inspected.username}
            className="flex min-w-0 items-center gap-2 text-sm font-medium hover:underline"
          >
            <MemberAvatar name={inspected.name} size="sm" frame={inspected.cosmetics?.frame} />
            <span className="truncate">{isSelf ? `${inspected.name} (you)` : inspected.name}</span>
            <BadgeGlyph badge={inspected.cosmetics?.badge} label={`${inspected.name}'s badge`} />
            <span className="shrink-0 font-normal text-muted">
              {formatDateKey(inspected.dateKey)}
            </span>
          </ProfileLink>
          <p className="mt-1 text-xs text-faint">
            {status === "resolved" ? (
              inspected.finalRank ? (
                <>
                  Finished #{inspected.finalRank}
                  {inspected.finalRank <= 3 ? (
                    <span aria-hidden> {RANK_MEDALS[inspected.finalRank - 1]}</span>
                  ) : null}{" "}
                  ·{" "}
                  <span className={clsx("font-semibold", net >= 0 ? "text-yes" : "text-no")}>
                    {formatSignedPoints(net)} pts
                  </span>
                </>
              ) : (
                "Unranked"
              )
            ) : isSelf && isOpen ? (
              "Your date — tap any open day to move it, free until close."
            ) : isOpen ? (
              "Already claimed — first come, first claimed."
            ) : (
              "Locked in — awaiting resolution."
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Close details"
          className="rounded-md p-1 text-faint transition-colors hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  if (status === "resolved") {
    const podium = guesses
      .filter((guess) => guess.finalRank !== null && guess.finalRank <= 3)
      .sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0));
    if (podium.length === 0) {
      return <p className="text-sm text-muted">Resolved — nobody was in.</p>;
    }
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        {podium.map((guess) => {
          const net = (guess.payout ?? 0) - ante;
          return (
            <span key={guess.userId} className="inline-flex items-center gap-1.5">
              <span aria-hidden>{RANK_MEDALS[(guess.finalRank ?? 1) - 1]}</span>
              <MemberAvatar name={guess.name} size="xs" frame={guess.cosmetics?.frame} />
              <span className="max-w-28 truncate font-medium">{guess.name}</span>
              <span
                className={clsx(
                  "text-xs font-semibold tabular-nums",
                  net >= 0 ? "text-yes" : "text-no",
                )}
              >
                {formatSignedPoints(net)}
              </span>
            </span>
          );
        })}
      </div>
    );
  }

  if (!isOpen) {
    return <p className="text-sm text-muted">Guessing closed — awaiting resolution.</p>;
  }

  return (
    <div>
      <p className="text-xs text-faint">
        Tap an open day to plant your flag — one date per player, movable until close. Ante{" "}
        {formatPoints(ante)} pts, winner-take-most: closest three split the pot 60/25/15.
      </p>
      <FieldError message={state.error} />
      {state.success ? <p className="mt-1 text-sm text-yes">{state.success}</p> : null}
    </div>
  );
}
