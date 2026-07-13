import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { Lock, Users } from "lucide-react";
import { JoinLeagueForm } from "@/components/leagues/join-league-form";
import { LeagueNav } from "@/components/leagues/league-nav";
import { BadgeGlyph } from "@/components/members/cosmetic-renderers";
import { ProfileLink } from "@/components/members/profile-link";
import { ensureLeagueAllowance } from "@/lib/server/allowance-service";
import { getUserCosmetics } from "@/lib/server/item-service";
import { getLeagueForViewer } from "@/lib/server/league-service";
import { requireSession } from "@/lib/session";

/**
 * Shell for every /l/[slug] page: resolves the league, gates non-members
 * (invite-only — they get a join prompt, not the content), lazily credits
 * the league's weekly allowance, and renders the header + tab nav.
 */
export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const { slug } = await params;

  const result = await getLeagueForViewer(slug, session.user.id);
  if (!result || result.league.isGlobal) {
    // the global league IS the app — its pages live at /dashboard etc.
    if (result?.league.isGlobal) {
      redirect("/dashboard");
    }
    notFound();
  }

  const { league, membership } = result;
  const isAppAdmin = session.user.role === UserRole.ADMIN;

  if (!membership && !isAppAdmin) {
    return (
      <section className="mx-auto max-w-md space-y-5 py-10 text-center">
        <Lock className="mx-auto size-8 text-faint" aria-hidden />
        <div>
          <h1 className="text-xl font-bold">{league.name}</h1>
          <p className="mt-1 text-sm text-muted">
            This league is invite-only. Enter its code to join.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 text-left">
          <JoinLeagueForm />
        </div>
      </section>
    );
  }

  // same lazy hook point as the global TopNav allowance
  await ensureLeagueAllowance(session.user.id, league);

  const canManage =
    isAppAdmin || membership?.role === "OWNER" || membership?.role === "MOD";

  const ownerCosmetics = league.owner ? await getUserCosmetics(league.owner.id) : null;

  return (
    <section className="space-y-5">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold leading-tight">{league.name}</h1>
          <span className="inline-flex items-center gap-1 text-xs text-muted tabular-nums">
            <Users className="size-3.5" aria-hidden />
            {league._count.memberships} member{league._count.memberships === 1 ? "" : "s"}
          </span>
          {league.owner ? (
            <span className="text-xs text-faint">
              run by{" "}
              <ProfileLink username={league.owner.username} className="font-medium text-muted hover:underline">
                {league.owner.name}
              </ProfileLink>{" "}
              <BadgeGlyph badge={ownerCosmetics?.badge} label={`${league.owner.name}'s badge`} />
            </span>
          ) : null}
        </div>
        {league.description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted">{league.description}</p>
        ) : null}
      </div>

      <LeagueNav slug={slug} canManage={canManage} />

      {children}
    </section>
  );
}
