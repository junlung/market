import { UserCheck } from "lucide-react";
import { MemberReview } from "@/components/admin/member-review";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import { listMembers } from "@/lib/server/member-service";
import { requireAdminSession } from "@/lib/session";

export default async function AdminMembersPage() {
  await requireAdminSession();
  const members = await listMembers();
  const pending = members.filter((member) => member.status === "PENDING");
  const active = members.filter((member) => member.status === "ACTIVE");

  return (
    <section className="space-y-5">
      <PageHeader
        title="Members"
        description="Approve new signups and see who's in the league. Approval grants the starting balance."
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">
          Pending approval {pending.length > 0 ? `(${pending.length})` : ""}
        </h2>
        {pending.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
            <UserCheck className="size-5 text-faint" aria-hidden />
            <p className="mt-2 text-sm text-muted">Queue&apos;s clear.</p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border bg-surface">
            {pending.map((user) => (
              <div
                key={user.id}
                data-testid={`member-row-${user.email}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={user.name} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted">{user.email}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      Signed up {formatDateTime(user.createdAt)}
                      {user.vouchedBy ? (
                        <>
                          {" · "}
                          <span className="text-yes">vouched by {user.vouchedBy.name}</span>
                          {user.vouchNote ? ` — "${user.vouchNote}"` : ""}
                        </>
                      ) : (
                        " · no vouch yet"
                      )}
                    </p>
                  </div>
                </div>
                <MemberReview userId={user.id} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted">Active members ({active.length})</h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-surface">
          {active.map((user) => (
            <div key={user.id} className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={user.name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {user.name}
                    {user.role === "ADMIN" ? (
                      <span className="ml-1.5 text-xs font-normal text-faint">admin</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-faint">
                    {user.email} · joined {formatDateTime(user.createdAt)}
                  </p>
                </div>
              </div>
              <StatusBadge label="active" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
