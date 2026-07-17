import clsx from "clsx";
import { MemberAvatar } from "@/components/members/member-avatar";
import type { TimelineGuess } from "./timeline-model";

export type FlagSpec = {
  entry: TimelineGuess;
  day: number;
  lane: 0 | 1;
  isOwn: boolean;
  /** The not-yet-submitted preview of the viewer's pending claim/move. */
  ghost?: boolean;
  medal?: string | null;
  dimmed?: boolean;
};

/**
 * One planted flag: a dot on the axis, a pole, an avatar head. Absolutely
 * positioned by the canvas at its day's center; the whole flag is a button
 * that opens the owner's detail strip below the track.
 */
export function GuessFlag({
  flag,
  x,
  label,
  onActivate,
}: {
  flag: FlagSpec;
  /** px of the flag's day-column center inside the track. */
  x: number;
  label: string;
  onActivate: () => void;
}) {
  const { entry, lane, isOwn, ghost, medal, dimmed } = flag;
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={label}
      className={clsx(
        "group/flag absolute bottom-12 z-10 flex -translate-x-1/2 flex-col-reverse items-center",
        "focus-visible:outline-none",
        dimmed && "opacity-50",
      )}
      style={{ left: x }}
    >
      <span
        aria-hidden
        className={clsx(
          "-mb-[3px] size-1.5 rounded-full",
          isOwn || ghost ? "bg-primary" : "bg-border-strong",
        )}
      />
      <span
        aria-hidden
        className={clsx(
          lane === 1 ? "h-12" : "h-6",
          ghost
            ? "w-0 border-l border-dashed border-primary"
            : clsx("w-px", isOwn ? "bg-primary" : "bg-border-strong"),
        )}
      />
      <span
        className={clsx(
          "relative rounded-full bg-surface p-0.5 ring-2 transition-transform",
          "group-hover/flag:scale-110 group-focus-visible/flag:ring-primary",
          isOwn || ghost ? "ring-primary" : "ring-border",
          ghost && "opacity-70",
        )}
      >
        <MemberAvatar name={entry.name} size="xs" frame={entry.cosmetics?.frame} />
        {medal ? (
          <span aria-hidden className="absolute -right-2 -top-2 text-xs">
            {medal}
          </span>
        ) : null}
      </span>
      {isOwn || ghost ? (
        <span className="mb-0.5 rounded-full bg-primary px-1 py-px text-[9px] font-bold leading-none text-primary-fg">
          {ghost ? "New" : "You"}
        </span>
      ) : null}
    </button>
  );
}
