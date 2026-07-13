"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ItemKind } from "@prisma/client";
import { equipItemAction, unequipSlotAction } from "@/app/actions/items";
import { BadgeGlyph, TitleLine } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { LockerItem } from "@/lib/server/item-service";
import type { BannerStyle } from "@/lib/cosmetics";

const SLOT_ORDER: Array<{ kind: ItemKind; label: string; slot: string }> = [
  { kind: "FRAME", label: "Frames", slot: "FRAME" },
  { kind: "BADGE", label: "Badges", slot: "BADGE" },
  { kind: "TITLE", label: "Titles", slot: "TITLE" },
  { kind: "BACKGROUND", label: "Banners", slot: "BACKGROUND" },
];

const SOURCE_LABEL: Record<LockerItem["source"], string> = {
  SEASON_TROPHY: "Season award",
  ACHIEVEMENT: "Achievement",
  PURCHASE: "Store",
  ADMIN_GRANT: "Special grant",
};

function BannerSwatch({ banner }: { banner: BannerStyle }) {
  const angle = { "to-r": "90deg", "to-br": "135deg", "to-b": "180deg" }[banner.direction ?? "to-r"];
  return (
    <span
      aria-hidden
      className="inline-block h-6 w-12 rounded-md border border-border"
      style={{ backgroundImage: `linear-gradient(${angle}, ${banner.from}, ${banner.to})` }}
    />
  );
}

/** One locker tile's mini preview, rendered with the real cosmetic renderers. */
function ItemPreview({ item, viewerName }: { item: LockerItem; viewerName: string }) {
  if (!item.style) {
    return <span className="text-xs text-faint">—</span>;
  }
  switch (item.style.kind) {
    case "FRAME":
      return <MemberAvatar name={viewerName} size="md" frame={item.style.style} />;
    case "BADGE":
      return <BadgeGlyph badge={item.style.style} label={item.name} className="text-xl" />;
    case "TITLE":
      return <TitleLine title={item.style.style} />;
    case "BACKGROUND":
      return <BannerSwatch banner={item.style.style} />;
    default:
      return <span className="text-xs text-faint">—</span>;
  }
}

/**
 * The account-page locker: your equippable inventory grouped by slot, with a
 * live "this is you" preview of the current loadout. Trophies live on the
 * profile's trophy case, not here.
 */
export function EquipPanel({ items, viewerName }: { items: LockerItem[]; viewerName: string }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const equipped = useMemo(() => {
    const map = new Map<ItemKind, LockerItem>();
    for (const item of items) {
      if (item.equipped) {
        map.set(item.kind, item);
      }
    }
    return map;
  }, [items]);

  function run(action: () => Promise<{ success?: string; error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.success) {
        toast.success(result.success);
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  }

  const frame = equipped.get("FRAME");
  const badge = equipped.get("BADGE");
  const title = equipped.get("TITLE");
  const banner = equipped.get("BACKGROUND");

  return (
    <div className="space-y-5">
      {/* live loadout preview */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-4">
        <MemberAvatar
          name={viewerName}
          size="lg"
          frame={frame?.style?.kind === "FRAME" ? frame.style.style : null}
        />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            {viewerName}
            <BadgeGlyph
              badge={badge?.style?.kind === "BADGE" ? badge.style.style : null}
              label="Your badge"
            />
          </p>
          <TitleLine title={title?.style?.kind === "TITLE" ? title.style.style : null} />
          {banner?.style?.kind === "BACKGROUND" ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              Profile banner: <BannerSwatch banner={banner.style.style} />
            </p>
          ) : null}
          <p className="mt-0.5 text-[11px] text-faint">
            This is how you look on leaderboards, comments, and your profile.
          </p>
        </div>
      </div>

      {SLOT_ORDER.map(({ kind, label, slot }) => {
        const group = items.filter((item) => item.kind === kind);
        if (group.length === 0) {
          return null;
        }
        return (
          <div key={kind}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{label}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((item) => (
                <div
                  key={item.userItemId}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center">
                    <ItemPreview item={item} viewerName={viewerName} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-[11px] text-faint">{SOURCE_LABEL[item.source]}</p>
                  </div>
                  {item.equipped ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => unequipSlotAction(slot))}
                    >
                      Unequip
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => equipItemAction(item.userItemId))}
                    >
                      Equip
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
