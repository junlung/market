import { Bell } from "lucide-react";
import { MarkAllReadButton } from "@/components/layout/mark-all-read-button";
import { NotificationRowButton } from "@/components/layout/notification-row";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getNotificationSnapshot } from "@/lib/server/notification-service";
import { requireSession } from "@/lib/session";

export default async function NotificationsPage() {
  const session = await requireSession();
  const { unreadCount, recent } = await getNotificationSnapshot(
    session.user.id,
    session.user.role === "ADMIN",
    50,
  );

  return (
    <section className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Settlements, verdicts, and things that need you — most recent 50."
        actions={unreadCount > 0 ? <MarkAllReadButton /> : undefined}
      />

      {recent.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing yet"
          description="Market results and updates land here. Place some bets and stir the pot."
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-1.5">
          {recent.map((item) => (
            <NotificationRowButton key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
