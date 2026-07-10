"use client";

import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";

export type TabDef = {
  id: string;
  label: string;
  count?: number;
};

/**
 * URL-synced tabs: active tab lives in a search param so links and refreshes
 * keep their place. Panels are server-rendered ReactNodes keyed by tab id
 * (a render-prop would be a function crossing the RSC boundary — not allowed).
 */
export function Tabs({
  tabs,
  param = "tab",
  defaultTab,
  panels,
}: {
  tabs: TabDef[];
  param?: string;
  defaultTab?: string;
  panels: Record<string, React.ReactNode>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get(param);
  const active =
    requested && tabs.some((tab) => tab.id === requested)
      ? requested
      : (defaultTab ?? tabs[0]?.id);

  function selectTab(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, id);
    router.replace(`?${params.toString()}` as Parameters<typeof router.replace>[0], { scroll: false });
  }

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => selectTab(tab.id)}
            className={clsx(
              "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-muted">
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="pt-4" role="tabpanel">
        {panels[active]}
      </div>
    </div>
  );
}
