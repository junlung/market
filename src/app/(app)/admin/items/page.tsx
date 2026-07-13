import Link from "next/link";
import type { Route } from "next";
import { Gem, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClasses } from "@/components/ui/button";
import { parseItemStyle } from "@/lib/cosmetics";
import { formatPoints } from "@/lib/format";
import { listAllItems } from "@/lib/server/item-service";
import { requireAdminSession } from "@/lib/session";

const KIND_LABEL: Record<string, string> = {
  TROPHY: "Trophy",
  BADGE: "Badge",
  TITLE: "Title",
  FRAME: "Frame",
  BACKGROUND: "Banner",
};

function itemGlyph(kind: string, style: unknown) {
  const parsed = parseItemStyle(kind as never, style);
  if (!parsed) return "∅";
  switch (parsed.kind) {
    case "BADGE":
      return parsed.style.glyph;
    case "TROPHY":
      return parsed.style.renderer === "emoji" ? parsed.style.emoji : "📦";
    case "FRAME":
      return "◎";
    case "TITLE":
      return "❝";
    case "BACKGROUND":
      return "▬";
  }
}

export default async function AdminItemsPage() {
  await requireAdminSession();
  const items = await listAllItems();

  return (
    <section className="space-y-5">
      <PageHeader
        title="Items & store"
        description="The cosmetic catalog: what exists, what it costs, who owns it. Retiring an item un-renders it everywhere without touching anyone's inventory."
        actions={
          <Link href={"/admin/items/new" as Route} className={buttonClasses("primary", "sm")}>
            <Plus className="size-4" aria-hidden /> New item
          </Link>
        }
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-4 py-2.5 font-medium">Kind</th>
              <th className="px-4 py-2.5 text-right font-medium">Price</th>
              <th className="px-4 py-2.5 text-right font-medium">Owned by</th>
              <th className="px-4 py-2.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={item.id} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/items/${item.id}` as Route}
                    className="flex items-center gap-2.5 font-medium hover:text-primary"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-base">
                      {itemGlyph(item.kind, item.style)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{item.name}</span>
                      <span className="block text-xs font-normal text-faint">{item.slug}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted">{KIND_LABEL[item.kind]}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {item.storeCost === null ? (
                    <span className="text-faint">earned only</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-gem">
                      <Gem className="size-3.5" aria-hidden />
                      {formatPoints(item.storeCost)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                  {item._count.userItems}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <StatusBadge label={item.active ? "active" : "retired"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
