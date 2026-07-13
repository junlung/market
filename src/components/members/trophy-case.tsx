import { Box, Trophy } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import { EmptyState } from "@/components/ui/empty-state";
import { parseItemStyle } from "@/lib/cosmetics";
import type { listUserItems } from "@/lib/server/item-service";

type Inventory = Awaited<ReturnType<typeof listUserItems>>;

/** "July 2026 · Global League" — where a season trophy came from. */
function provenanceLabel(provenance: unknown) {
  if (!provenance || typeof provenance !== "object") {
    return null;
  }
  const record = provenance as Record<string, unknown>;
  const parts = [record.seasonName, record.league].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function TrophyCase({ inventory, ownProfile }: { inventory: Inventory; ownProfile: boolean }) {
  if (inventory.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No trophies yet"
        description={
          ownProfile
            ? "Win a league season or hit an achievement and it shows up here."
            : "Nothing in the case yet. Give it time — or don't, and enjoy the lead."
        }
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {inventory.map((owned) => {
        const parsed = parseItemStyle(owned.item.kind, owned.item.style);
        const trophyStyle = parsed?.kind === "TROPHY" ? parsed.style : null;
        const is3d = trophyStyle?.renderer === "model3d";
        const emoji = trophyStyle?.renderer === "emoji" ? trophyStyle.emoji : null;
        const wonAt = provenanceLabel(owned.provenance);
        return (
          <div
            key={owned.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4"
          >
            {is3d ? (
              // reserved mount for the low-poly WebGL viewer — the tile is
              // already sized, so the canvas drops in with zero layout rework
              <span
                data-model-src={trophyStyle.src}
                data-model-mount
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl"
              >
                {trophyStyle.fallbackEmoji ?? <Box className="size-5 text-faint" aria-hidden />}
              </span>
            ) : (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl">
                {emoji ?? <Trophy className="size-5 text-faint" aria-hidden />}
              </span>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                {owned.item.name}
                {is3d ? (
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-medium text-faint">
                    3D
                  </span>
                ) : null}
              </p>
              <p className="line-clamp-2 text-xs text-muted">{owned.item.description}</p>
              <p className="mt-1 text-[11px] text-faint">
                {wonAt ? <>{wonAt} · </> : null}
                <LocalTime date={owned.grantedAt} mode="date" />
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
