import { Inbox } from "lucide-react";
import { FeedbackReview } from "@/components/admin/feedback-review";
import { Avatar } from "@/components/ui/avatar";
import { LocalTime } from "@/components/ui/local-time";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { listFeedback } from "@/lib/server/feedback-service";
import { requireAdminSession } from "@/lib/session";

export default async function AdminFeedbackPage() {
  await requireAdminSession();
  const feedback = await listFeedback();
  const unresolved = feedback.filter((entry) => !entry.resolvedAt);
  const resolved = feedback.filter((entry) => entry.resolvedAt);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Feedback"
        description="What members sent from the in-app form. The page shown is where they were when they hit send."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Unresolved"
          value={String(unresolved.length)}
          hint="Waiting on you"
          tone={unresolved.length > 0 ? "no" : "default"}
        />
        <StatCard label="Resolved" value={String(resolved.length)} hint="Handled" />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">
          Unresolved {unresolved.length > 0 ? `(${unresolved.length})` : ""}
        </h2>
        {unresolved.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
            <Inbox className="size-5 text-faint" aria-hidden />
            <p className="mt-2 text-sm text-muted">Inbox zero. Either it all works or nobody&apos;s telling you.</p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {unresolved.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar name={entry.user.name} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.user.name}</p>
                    <p className="text-xs text-faint">
                      <LocalTime date={entry.createdAt} />
                      {/* user-supplied — rendered as plain text, never a link */}
                      {entry.path ? ` · on ${entry.path}` : ""}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">{entry.message}</p>
                  </div>
                </div>
                <FeedbackReview feedbackId={entry.id} resolved={false} />
              </div>
            ))}
          </div>
        )}
      </div>

      {resolved.length > 0 ? (
        <details className="rounded-xl border border-border bg-surface">
          <summary className="cursor-pointer p-4 text-sm font-semibold text-muted">
            Resolved ({resolved.length})
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {resolved.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar name={entry.user.name} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.user.name}</p>
                    <p className="text-xs text-faint">
                      <LocalTime date={entry.createdAt} />
                      {entry.path ? ` · on ${entry.path}` : ""}
                      {entry.resolvedAt ? (
                        <>
                          {" · resolved "}
                          <LocalTime date={entry.resolvedAt} />
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted">{entry.message}</p>
                  </div>
                </div>
                <FeedbackReview feedbackId={entry.id} resolved />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
