import Link from "next/link";
import type { Route } from "next";
import { Crown, Mail, Shield, Users } from "lucide-react";
import { createLeagueAction } from "@/app/actions/leagues";
import { InviteResponseButtons } from "@/components/leagues/invite-response-buttons";
import { JoinLeagueForm } from "@/components/leagues/join-league-form";
import { LeagueForm } from "@/components/leagues/league-form";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listPendingInvitesForUser, listUserLeagues } from "@/lib/server/league-service";
import { requireSession } from "@/lib/session";

const ROLE_LABEL = { OWNER: "Owner", MOD: "Mod", MEMBER: "Member" } as const;

export default async function LeaguesPage() {
  const session = await requireSession();
  const [leagues, invites] = await Promise.all([
    listUserLeagues(session.user.id),
    listPendingInvitesForUser(session.user.id),
  ]);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Leagues"
        description="Private leagues with their own markets, stacks, and seasons — invite-only, fresh stack every season. The Global League is the rest of the app."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {invites.length > 0 ? (
            <div className="rounded-xl border border-primary/40 bg-surface p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Mail className="size-4 text-primary" aria-hidden />
                Invites for you
              </p>
              <ul className="mt-3 space-y-3">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">{invite.league.name}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {invite.invitedBy ? `Invited by ${invite.invitedBy.name} · ` : ""}
                        {invite.league._count.memberships} member
                        {invite.league._count.memberships === 1 ? "" : "s"}
                      </p>
                    </div>
                    <InviteResponseButtons inviteId={invite.id} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {leagues.length === 0 ? (
            <EmptyState
              icon={Crown}
              title="No leagues yet"
              description="Create one for your group or join with an invite code."
            />
          ) : (
            leagues.map(({ league, role }) => (
              <Link
                key={league.id}
                href={`/l/${league.slug}` as Route}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    {league.name}
                    {role !== "MEMBER" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-medium text-warn">
                        <Shield className="size-3" aria-hidden /> {ROLE_LABEL[role]}
                      </span>
                    ) : null}
                  </p>
                  {league.description ? (
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted">{league.description}</p>
                  ) : null}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted tabular-nums">
                  <Users className="size-3.5" aria-hidden />
                  {league._count.memberships}
                </span>
              </Link>
            ))
          )}

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold">Have an invite code?</p>
            <div className="mt-3">
              <JoinLeagueForm />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Start a league</h2>
          <LeagueForm action={createLeagueAction} />
        </div>
      </div>
    </section>
  );
}
