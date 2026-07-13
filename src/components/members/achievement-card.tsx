import clsx from "clsx";
import { Gem, Lock } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import type { AchievementProgress } from "@/lib/server/achievement-service";

/**
 * One achievement as a card: lit when earned (with the earn date and gem
 * reward), dimmed with a lock when still unearned. Pure — the own-profile
 * Highlight toggle is threaded in via `action`.
 */
export function AchievementCard({
  progress,
  action,
}: {
  progress: AchievementProgress;
  action?: React.ReactNode;
}) {
  const { def, earned, showcased } = progress;

  return (
    <div
      className={clsx(
        "flex items-start gap-3 rounded-xl border bg-surface p-4",
        earned ? "border-border" : "border-dashed border-border opacity-60",
        showcased && "border-warn/40",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl">
        {earned ? def.emoji : <Lock className="size-4 text-faint" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          {def.name}
          <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-gem tabular-nums">
            <Gem className="size-3" aria-hidden />
            {def.gems}
          </span>
        </p>
        <p className="text-xs text-muted">{def.description}</p>
        <p className="mt-1 text-[11px] text-faint">
          {earned ? (
            <>
              Earned <LocalTime date={earned.at} mode="date" />
            </>
          ) : (
            "Not earned yet"
          )}
        </p>
      </div>
      {action}
    </div>
  );
}
