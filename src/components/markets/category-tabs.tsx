import Link from "next/link";
import type { Route } from "next";
import clsx from "clsx";
import { categoryLabel } from "@/lib/categories";

export function CategoryTabs({
  categories,
  active,
  query,
}: {
  categories: string[];
  active?: string;
  query?: string;
}) {
  const tabs = [
    { id: "", label: "All" },
    ...categories.map((category) => ({ id: category, label: categoryLabel(category) })),
  ];

  function href(categoryId: string) {
    const params = new URLSearchParams();
    if (categoryId) {
      params.set("category", categoryId);
    }
    if (query) {
      params.set("q", query);
    }
    const qs = params.toString();
    return (qs ? `/dashboard?${qs}` : "/dashboard") as Route;
  }

  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {tabs.map((tab) => {
        const selected = (active ?? "") === tab.id;
        return (
          <Link
            key={tab.id || "all"}
            href={href(tab.id)}
            className={clsx(
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-foreground text-background"
                : "bg-surface-2 text-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
