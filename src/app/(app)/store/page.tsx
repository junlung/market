import Link from "next/link";
import type { ItemKind } from "@prisma/client";
import { Gem } from "lucide-react";
import { BadgeGlyph, TitleLine } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { BuyButton } from "@/components/store/buy-button";
import { PageHeader } from "@/components/ui/page-header";
import { formatPoints } from "@/lib/format";
import { getGemBalance } from "@/lib/server/gem-service";
import { getStoreCatalog, type StoreCatalogItem } from "@/lib/server/item-service";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Store · ProllyMarket" };

const KIND_SECTIONS: Array<{ kind: ItemKind; title: string; blurb: string }> = [
  { kind: "FRAME", title: "Frames", blurb: "Rings and glows around your avatar, everywhere it shows." },
  { kind: "BADGE", title: "Badges", blurb: "A glyph next to your name on leaderboards, comments, and feeds." },
  { kind: "TITLE", title: "Titles", blurb: "A line under your name on your profile and the podium." },
  { kind: "BACKGROUND", title: "Banners", blurb: "A backdrop for your profile header." },
];

function StorePreview({ item, viewerName }: { item: StoreCatalogItem; viewerName: string }) {
  if (!item.style) {
    return null;
  }
  switch (item.style.kind) {
    case "FRAME":
      return <MemberAvatar name={viewerName} size="md" frame={item.style.style} />;
    case "BADGE":
      return (
        <span className="inline-flex items-center gap-1 text-sm font-medium">
          {viewerName.split(/\s+/)[0]}
          <BadgeGlyph badge={item.style.style} label={item.name} />
        </span>
      );
    case "TITLE":
      return <TitleLine title={item.style.style} />;
    case "BACKGROUND": {
      const angle = { "to-r": "90deg", "to-br": "135deg", "to-b": "180deg" }[
        item.style.style.direction ?? "to-r"
      ];
      return (
        <span
          aria-hidden
          className="inline-block h-8 w-16 rounded-md border border-border"
          style={{
            backgroundImage: `linear-gradient(${angle}, ${item.style.style.from}, ${item.style.style.to})`,
          }}
        />
      );
    }
    default:
      return null;
  }
}

export default async function StorePage() {
  const session = await requireSession();
  const [catalog, gems] = await Promise.all([
    getStoreCatalog(session.user.id),
    getGemBalance(session.user.id),
  ]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Store"
          description="Spend gems on frames, badges, titles, and banners. Gems come from winning raked markets, achievements, and season podiums — they never buy bets."
        />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-gem tabular-nums">
          <Gem className="size-4" aria-hidden />
          {formatPoints(gems)} gems
        </span>
      </div>

      {KIND_SECTIONS.map(({ kind, title, blurb }) => {
        const items = catalog.filter((item) => item.kind === kind);
        if (items.length === 0) {
          return null;
        }
        return (
          <div key={kind} className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="text-xs text-muted">{blurb}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <div
                  key={item.itemId}
                  className="flex flex-col rounded-xl border border-border bg-surface p-4"
                >
                  <div className="flex h-14 items-center justify-center rounded-lg bg-surface-2">
                    <StorePreview item={item} viewerName={session.user.name ?? "You"} />
                  </div>
                  <p className="mt-3 text-sm font-semibold">{item.name}</p>
                  <p className="mt-0.5 flex-1 text-xs text-muted">{item.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-gem tabular-nums">
                      <Gem className="size-3.5" aria-hidden />
                      {formatPoints(item.storeCost)}
                    </span>
                    {item.owned ? (
                      <Link
                        href="/account"
                        className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground"
                      >
                        Owned — equip it →
                      </Link>
                    ) : (
                      <BuyButton
                        itemSlug={item.slug}
                        cost={item.storeCost}
                        disabled={gems < item.storeCost}
                        shortfall={Math.max(0, item.storeCost - gems)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-xs leading-relaxed text-faint">
        Some items can&apos;t be bought at any price — trophies and certain badges are earned only.
        Your gem balance never resets and never touches your points.
      </p>
    </section>
  );
}
