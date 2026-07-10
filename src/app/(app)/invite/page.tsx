import { Link2, UserPlus } from "lucide-react";
import { VouchForm } from "@/components/members/vouch-form";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { formatRelativeTime } from "@/lib/format";
import { listPendingUsers } from "@/lib/server/member-service";
import { requireSession } from "@/lib/session";

export default async function InvitePage() {
  const session = await requireSession();
  const pending = await listPendingUsers();

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Invite friends"
        description="Send them the app link — they sign up, an admin approves, and they're in. Vouching speeds that up."
      />

      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <Link2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-muted">
          Tell your friend to sign up at this site&apos;s <span className="font-medium text-foreground">/sign-up</span>{" "}
          page with any email. Their account sits in the queue until an admin lets them in — vouch below so the
          admins know they&apos;re legit.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">Waiting for approval</h2>
        {pending.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
            <UserPlus className="size-5 text-faint" aria-hidden />
            <p className="mt-2 text-sm text-muted">Nobody in the queue. More friends, bigger pots.</p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {pending.map((user) => (
              <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={user.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-faint">
                      Signed up {formatRelativeTime(user.createdAt)}
                      {user.vouchedBy ? ` · vouched by ${user.vouchedBy.name}` : ""}
                    </p>
                  </div>
                </div>
                {user.vouchedBy || user.id === session.user.id ? null : <VouchForm userId={user.id} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
