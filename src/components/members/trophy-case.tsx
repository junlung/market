import { Trophy } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import { EmptyState } from "@/components/ui/empty-state";
import type { listUserItems } from "@/lib/server/item-service";

type Inventory = Awaited<ReturnType<typeof listUserItems>>;

function itemEmoji(style: unknown) {
  if (style && typeof style === "object" && "emoji" in style && typeof style.emoji === "string") {
    return style.emoji;
  }
  return null;
}

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
        const emoji = itemEmoji(owned.item.style);
        const wonAt = provenanceLabel(owned.provenance);
        return (
          <div
            key={owned.id}
            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl">
              {emoji ?? <Trophy className="size-5 text-faint" aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{owned.item.name}</p>
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
