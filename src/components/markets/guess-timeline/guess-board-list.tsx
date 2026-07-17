import { BadgeGlyph } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProfileLink } from "@/components/members/profile-link";
import { formatSignedPoints } from "@/lib/format";
import { formatDateKey } from "@/lib/guess-dates";
import { RANK_MEDALS, type TimelineGuess } from "./timeline-model";

/**
 * The board as a table: every claim in date order while the market runs,
 * ranked with medals and net points once it resolves.
 */
export function GuessBoardList({
  guesses,
  ante,
  isResolved,
}: {
  guesses: TimelineGuess[];
  ante: number;
  isResolved: boolean;
}) {
  const ranked = isResolved
    ? [...guesses].sort(
        (a, b) => (a.finalRank ?? Number.MAX_SAFE_INTEGER) - (b.finalRank ?? Number.MAX_SAFE_INTEGER),
      )
    : guesses;

  if (ranked.length === 0) {
    return (
      <p className="py-3 text-sm text-muted">Nobody&apos;s in yet — the timeline is wide open.</p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {ranked.map((guess) => (
        <li key={guess.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
          <ProfileLink
            username={guess.username}
            className="flex min-w-0 items-center gap-2 font-medium hover:underline"
          >
            {isResolved && guess.finalRank && guess.finalRank <= 3 ? (
              <span aria-hidden>{RANK_MEDALS[guess.finalRank - 1]}</span>
            ) : null}
            <MemberAvatar name={guess.name} size="xs" frame={guess.cosmetics?.frame} />
            <span className="truncate">{guess.name}</span>
            <BadgeGlyph badge={guess.cosmetics?.badge} label={`${guess.name}'s badge`} />
          </ProfileLink>
          <span className="flex shrink-0 items-center gap-3 tabular-nums">
            <span>{formatDateKey(guess.dateKey)}</span>
            {isResolved ? (
              <span
                className={
                  (guess.payout ?? 0) - ante >= 0
                    ? "text-xs font-semibold text-yes"
                    : "text-xs font-semibold text-no"
                }
              >
                {formatSignedPoints((guess.payout ?? 0) - ante)}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
