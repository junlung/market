import { UserCheck } from "lucide-react";
import { MemberReview } from "@/components/admin/member-review";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatPoints } from "@/lib/format";
import { getMembersOverview } from "@/lib/server/member-service";
import { requireAdminSession } from "@/lib/session";

export default async function AdminMembersPage() {
  await requireAdminSession();
  const members = await getMembersOverview();
  const pending = members.filter((member) => member.status === "PENDING");
  const active = members.filter((member) => member.status === "ACTIVE");
  const rejected = members.filter((member) => member.status === "REJECTED");
  const vouched = pending.filter((member) => member.vouchedBy);

  return (
    <section className="space-y-5">
      <PageHeader
        title="Members"
        description="Everyone who's in, applied, been vouched for, or been turned away. Approval grants the starting balance."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active" value={String(active.length)} hint="Playing" />
        <StatCard label="Pending" value={String(pending.length)} hint="Waiting on you" tone={pending.length > 0 ? "no" : "default"} />
        <StatCard label="Vouched" value={String(vouched.length)} hint="Pending with a member's backing" tone={vouched.length > 0 ? "yes" : "default"} />
        <StatCard label="Rejected" value={String(rejected.length)} hint="Can re-apply or be approved below" />
      </div>

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
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {user.name}
                      {user.vouchedBy ? <StatusBadge label="vouched" /> : null}
                    </p>
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
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-semibold tabular-nums">{formatPoints(user.balance)} pts</span>
                <StatusBadge label="active" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {rejected.length > 0 ? (
        <details className="rounded-xl border border-border bg-surface">
          <summary className="cursor-pointer p-4 text-sm font-semibold text-muted">
            Rejected ({rejected.length}) — approving one lets them in with a fresh starting balance
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {rejected.map((user) => (
              <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={user.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted">{user.email}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      Rejected {user.reviewedAt ? formatDateTime(user.reviewedAt) : ""}
                      {user.reviewNote ? ` — "${user.reviewNote}"` : ""}
                    </p>
                  </div>
                </div>
                <MemberReview userId={user.id} canReject={false} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
