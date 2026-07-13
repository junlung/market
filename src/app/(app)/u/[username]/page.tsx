import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketStatus } from "@prisma/client";
import clsx from "clsx";
import { CalendarDays, Pencil } from "lucide-react";
import { AchievementCard } from "@/components/members/achievement-card";
import { BadgeGlyph, ProfileBanner, TitleLine } from "@/components/members/cosmetic-renderers";
import { MemberAvatar } from "@/components/members/member-avatar";
import { TrophyCase } from "@/components/members/trophy-case";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalTime } from "@/components/ui/local-time";
import { StatCard } from "@/components/ui/stat-card";
import { formatChance, formatPoints, formatSignedPoints } from "@/lib/format";
import { getProfileByUsername } from "@/lib/server/profile-service";
import { requireSession } from "@/lib/session";

type Props = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { username } = await params;
  return { title: `@${username.toLowerCase()} · ProllyMarket` };
}

export default async function ProfilePage({ params }: Props) {
  const session = await requireSession();
  const { username } = await params;
  const profile = await getProfileByUsername(username.toLowerCase());

  if (!profile) {
    notFound();
  }

  const ownProfile = profile.id === session.user.id;
  const { stats } = profile;

  return (
    <section className="space-y-5">
      <ProfileBanner
        banner={profile.cosmetics.banner}
        className="rounded-xl border border-border bg-surface p-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <MemberAvatar name={profile.name} size="lg" frame={profile.cosmetics.frame} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h1 className="text-xl font-semibold">{profile.name}</h1>
              <BadgeGlyph badge={profile.cosmetics.badge} label={`${profile.name}'s badge`} />
              <span className="text-sm text-muted">@{profile.username}</span>
              {profile.role === "ADMIN" ? (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-faint">
                  admin
                </span>
              ) : null}
            </div>
            <TitleLine title={profile.cosmetics.title} className="mt-0.5 block" />
            {profile.bio ? (
              <p className="mt-1.5 max-w-prose text-sm text-muted">{profile.bio}</p>
            ) : null}
            <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
              <CalendarDays className="size-3.5" aria-hidden />
              Member since <LocalTime date={profile.createdAt} mode="date" />
            </p>
          </div>
          {ownProfile ? (
            <Link
              href="/account"
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover"
            >
              <Pencil className="size-3.5" aria-hidden /> Edit profile
            </Link>
          ) : null}
        </div>
      </ProfileBanner>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Net profit"
          value={`${formatSignedPoints(stats.netProfit)} pts`}
          tone={stats.netProfit > 0 ? "yes" : stats.netProfit < 0 ? "no" : "default"}
          hint="All-time, counting open positions"
        />
        <StatCard
          label="Markets won"
          value={stats.marketsWon}
          hint={`of ${stats.marketsPlayed} settled`}
        />
        <StatCard
          label="Win rate"
          value={stats.winRate === null ? "—" : formatChance(stats.winRate)}
        />
        <StatCard
          label="Biggest payout"
          value={`${formatPoints(stats.biggestPayout)} pts`}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">Achievements</h2>
          <Link
            href={`/u/${profile.username}/achievements`}
            className="text-xs font-medium text-primary hover:text-primary-hover"
          >
            All achievements →
          </Link>
        </div>
        {profile.showcasedAchievements.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
            {ownProfile
              ? "Nothing earned yet — win a market and it starts here."
              : `${profile.name} hasn't earned any achievements yet.`}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profile.showcasedAchievements.map((row) => (
              <AchievementCard key={row.def.key} progress={row} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">Trophy case</h2>
        <TrophyCase inventory={profile.trophyCase} ownProfile={ownProfile} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">Recent results</h2>
        {profile.recentResults.length === 0 ? (
          <EmptyState
            title="No settled markets yet"
            description={
              ownProfile
                ? "Once a market you bet on resolves, the result lands here."
                : `${profile.name} hasn't had a market settle yet.`
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <ul className="divide-y divide-border">
              {profile.recentResults.map((result) => (
                <li key={result.market.id}>
                  <Link
                    href={`/markets/${result.market.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{result.market.title}</p>
                      <p className="text-xs text-muted">
                        {result.market.status === MarketStatus.CANCELED
                          ? "Canceled — refunded"
                          : result.market.winningOutcome
                            ? `Resolved: ${result.market.winningOutcome.emoji ? `${result.market.winningOutcome.emoji} ` : ""}${result.market.winningOutcome.label}`
                            : "Resolved"}
                        {result.settledAt ? (
                          <>
                            {" · "}
                            <LocalTime date={result.settledAt} mode="date" />
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        result.net > 0 ? "text-yes" : result.net < 0 ? "text-no" : "text-faint",
                      )}
                    >
                      {formatSignedPoints(result.net)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
