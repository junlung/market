import { Activity } from "lucide-react";
import { ActivityList } from "@/components/markets/activity-row";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getActivityFeed } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

export default async function ActivityPage() {
  await requireSession();
  const feed = await getActivityFeed(50);

  return (
    <section className="space-y-5">
      <PageHeader title="Activity" description="Every bet across the league, as it happens." />

      {feed.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="All quiet"
          description="No bets anywhere yet. Someone has to go first."
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface px-4">
          <ActivityList items={feed} />
        </div>
      )}
    </section>
  );
}
