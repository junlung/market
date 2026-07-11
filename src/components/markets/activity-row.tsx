import Link from "next/link";
import clsx from "clsx";
import { Avatar } from "@/components/ui/avatar";
import { formatChance, formatPoints, formatRelativeTime } from "@/lib/format";
import { outcomeColorVar } from "@/lib/outcome-colors";

export type ActivityItem = {
  id: string;
  userName: string;
  outcomeLabel: string;
  outcomeColor: string;
  amount: number;
  probabilityAfter: number;
  createdAt: Date;
  marketId?: string;
  marketTitle?: string;
};

export function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Avatar name={item.userName} size="sm" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate">
          <span className="font-semibold">{item.userName}</span>{" "}
          <span className="text-muted">bet</span>{" "}
          <span className="font-semibold tabular-nums">{formatPoints(item.amount)} pts</span>{" "}
          <span className="text-muted">on</span>{" "}
          <span className="font-bold" style={{ color: outcomeColorVar(item.outcomeColor) }}>
            {item.outcomeLabel}
          </span>
          {item.marketId && item.marketTitle ? (
            <>
              {" "}
              <span className="text-muted">in</span>{" "}
              <Link href={`/markets/${item.marketId}`} className="font-medium hover:text-primary">
                {item.marketTitle}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <span className="hidden text-xs text-muted tabular-nums sm:block">
        → {formatChance(item.probabilityAfter)}
      </span>
      <span className="shrink-0 text-xs text-faint">{formatRelativeTime(item.createdAt)}</span>
    </div>
  );
}

export function ActivityList({ items, className }: { items: ActivityItem[]; className?: string }) {
  return (
    <div className={clsx("divide-y divide-border", className)}>
      {items.map((item) => (
        <ActivityRow key={item.id} item={item} />
      ))}
    </div>
  );
}
