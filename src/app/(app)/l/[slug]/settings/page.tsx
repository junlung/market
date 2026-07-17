import { notFound } from "next/navigation";
import { LeagueRole, SeasonStatus, UserRole } from "@prisma/client";
import { CalendarClock } from "lucide-react";
import { updateLeagueSettingsAction } from "@/app/actions/leagues";
import { DeleteLeagueCard } from "@/components/leagues/delete-league-card";
import { InviteCodeCard } from "@/components/leagues/invite-code-card";
import { InviteMemberForm } from "@/components/leagues/invite-member-form";
import { LeagueForm } from "@/components/leagues/league-form";
import { MemberRoleToggle } from "@/components/leagues/member-role-row";
import { RevokeInviteButton } from "@/components/leagues/revoke-invite-button";
import { SeasonForm } from "@/components/leagues/season-form";
import { BadgeGlyph } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProfileLink } from "@/components/members/profile-link";
import { LocalTime } from "@/components/ui/local-time";
import { getEquippedCosmetics } from "@/lib/server/item-service";
import {
  getActiveSeason,
  getLeagueForViewer,
  getUpcomingSeason,
  listInvitableUsers,
  listLeagueInvites,
  listLeagueMembers,
} from "@/lib/server/league-service";
import { hasStartedSeason, listSeasons } from "@/lib/server/season-service";
import { requireSession } from "@/lib/session";

const ROLE_LABEL = { OWNER: "Owner", MOD: "Mod", MEMBER: "Member" } as const;

export default async function LeagueSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await requireSession();
  const { slug } = await params;
  const result = await getLeagueForViewer(slug, session.user.id);
  if (!result || result.league.isGlobal) {
    notFound();
  }
  const { league, membership } = result;

  const isAppAdmin = session.user.role === UserRole.ADMIN;
  const isOwner = membership?.role === LeagueRole.OWNER || isAppAdmin;
  const canManage = isOwner || membership?.role === LeagueRole.MOD;
  if (!canManage) {
    notFound();
  }

  const [members, activeSeason, upcomingSeason, settingsLocked, seasons, invitable, invites] =
    await Promise.all([
      listLeagueMembers(league.id),
      getActiveSeason(league.id),
      getUpcomingSeason(league.id),
      hasStartedSeason(league.id),
      listSeasons(league.id),
      listInvitableUsers(league.id),
      listLeagueInvites(league.id),
    ]);

  const cosmetics = await getEquippedCosmetics(members.map((row) => row.user.id));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {league.inviteCode ? (
          <InviteCodeCard leagueId={league.id} slug={slug} code={league.inviteCode} />
        ) : null}

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Invites</p>
          <div className="mt-3">
            <InviteMemberForm
              leagueId={league.id}
              slug={slug}
              candidates={invitable.map((user) => ({
                id: user.id,
                name: user.name,
                username: user.username,
              }))}
            />
          </div>
          {invites.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {invites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{invite.user.name}</span>
                    <span className="text-xs text-muted">
                      invited <LocalTime date={invite.createdAt} />
                    </span>
                  </span>
                  <RevokeInviteButton inviteId={invite.id} slug={slug} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Members</p>
          <ul className="mt-2 divide-y divide-border">
            {members.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <ProfileLink
                  username={row.user.username}
                  className="flex min-w-0 items-center gap-2 font-medium hover:underline"
                >
                  <MemberAvatar
                    name={row.user.name}
                    size="xs"
                    frame={cosmetics.get(row.user.id)?.frame}
                  />
                  <span className="truncate">{row.user.name}</span>
                  <BadgeGlyph
                    badge={cosmetics.get(row.user.id)?.badge}
                    label={`${row.user.name}'s badge`}
                  />
                </ProfileLink>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted">{ROLE_LABEL[row.role]}</span>
                  {isOwner && row.role !== LeagueRole.OWNER ? (
                    <MemberRoleToggle
                      leagueId={league.id}
                      slug={slug}
                      userId={row.user.id}
                      currentRole={row.role === LeagueRole.MOD ? "MOD" : "MEMBER"}
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
            <CalendarClock className="size-3.5" aria-hidden /> Seasons
          </p>
          {!activeSeason && !upcomingSeason ? (
            <div className="mt-3">
              <SeasonForm leagueId={league.id} slug={slug} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {activeSeason ? (
                <>
                  <span className="font-medium text-foreground">{activeSeason.name}</span> is live —
                  ends <LocalTime date={activeSeason.endsAt} />. The next one can start after it
                  finalizes (all markets settled).
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{upcomingSeason!.name}</span> starts{" "}
                  <LocalTime date={upcomingSeason!.startsAt} />.
                </>
              )}
            </p>
          )}
          {seasons.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted">
              {seasons.map((season) => (
                <li key={season.id} className="flex justify-between gap-2 tabular-nums">
                  <span>{season.name}</span>
                  <span>
                    <LocalTime date={season.startsAt} mode="date" /> –{" "}
                    <LocalTime date={season.endsAt} mode="date" /> ·{" "}
                    {season.status === SeasonStatus.FINALIZED
                      ? "finalized"
                      : season.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">League settings</h2>
        {isOwner ? (
          <>
            <LeagueForm
              action={updateLeagueSettingsAction}
              league={league}
              settingsLocked={settingsLocked}
              submitLabel="Save settings"
            />
            <DeleteLeagueCard
              leagueId={league.id}
              leagueName={league.name}
              seasonActive={Boolean(activeSeason)}
            />
          </>
        ) : (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            Only the owner can change league settings. Mods can rotate the invite code and run
            markets and seasons.
          </p>
        )}
      </div>
    </div>
  );
}
