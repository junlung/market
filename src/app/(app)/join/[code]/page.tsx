import { redirect } from "next/navigation";
import type { Route } from "next";
import { Link2Off, Users } from "lucide-react";
import Link from "next/link";
import { JoinConfirmButton } from "@/components/leagues/join-confirm-button";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getLeagueByInviteCode, getLeagueMembership } from "@/lib/server/league-service";
import { requireSession } from "@/lib/session";

/**
 * The shareable invite-link landing: /join/<code>. Confirms before joining —
 * the code alone never creates a membership. Rotated/invalid codes get a
 * friendly dead-end, and existing members are sent straight to the league.
 */
export default async function JoinByCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await requireSession(`/join/${code}`);

  const league = await getLeagueByInviteCode(code);
  if (!league) {
    return (
      <section className="mx-auto max-w-md py-10">
        <EmptyState
          icon={Link2Off}
          title="This invite link isn't valid anymore"
          description="The code may have been rotated. Ask whoever sent it for a fresh one."
          action={
            <Link href="/leagues" className={buttonClasses("secondary", "sm")}>
              Your leagues
            </Link>
          }
        />
      </section>
    );
  }

  const membership = await getLeagueMembership(league.id, session.user.id);
  if (membership) {
    redirect(`/l/${league.slug}` as Route);
  }

  return (
    <section className="mx-auto max-w-md py-10">
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">
          You&apos;re invited to
        </p>
        <h1 className="mt-1 text-2xl font-bold">{league.name}</h1>
        {league.description ? (
          <p className="mt-2 text-sm text-muted">{league.description}</p>
        ) : null}
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted tabular-nums">
          <Users className="size-3.5" aria-hidden />
          {league._count.memberships} member{league._count.memberships === 1 ? "" : "s"}
        </p>
        <div className="mt-5 flex justify-center">
          <JoinConfirmButton code={code} leagueName={league.name} />
        </div>
      </div>
    </section>
  );
}
