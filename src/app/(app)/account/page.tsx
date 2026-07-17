import Link from "next/link";
import { LocalTime } from "@/components/ui/local-time";
import { ExternalLink, Gem, Gift, Shirt, UserPlus } from "lucide-react";
import clsx from "clsx";
import { BadgeGlyph, TitleLine } from "@/components/members/cosmetic-renderers";
import { BioForm } from "@/components/members/bio-form";
import { DisplayNameForm } from "@/components/members/display-name-form";
import { EquipPanel } from "@/components/members/equip-panel";
import { MemberAvatar } from "@/components/members/member-avatar";
import { UsernameForm } from "@/components/members/username-form";
import { PageHeader } from "@/components/ui/page-header";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { appConfig } from "@/lib/config";
import { formatPoints, formatRelativeTime, formatSignedPoints } from "@/lib/format";
import { getNextIsoWeekStart } from "@/lib/allowance";
import { hasCurrentWeekAllowance } from "@/lib/server/allowance-service";
import { getGemBalance, getGemBreakdown } from "@/lib/server/gem-service";
import { getLocker, getUserCosmetics } from "@/lib/server/item-service";
import { getSelfProfile } from "@/lib/server/member-service";
import { getBalanceBreakdown, getLedgerEntries } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

const TYPE_LABELS: Record<string, string> = {
  INITIAL_GRANT: "Starting balance",
  WEEKLY_ALLOWANCE: "Weekly allowance",
  BET_PLACED: "Bet placed",
  MARKET_PAYOUT: "Payout",
  MARKET_REFUND: "Refund",
  BET_VOID_REFUND: "Late bet refund",
};

export default async function AccountPage() {
  const session = await requireSession();
  const [profile, breakdown, entries, allowanceLanded, cosmetics, locker, gems, gemBreakdown] =
    await Promise.all([
      getSelfProfile(session.user.id),
      getBalanceBreakdown(session.user.id),
      getLedgerEntries(session.user.id),
      hasCurrentWeekAllowance(session.user.id),
      getUserCosmetics(session.user.id),
      getLocker(session.user.id),
      getGemBalance(session.user.id),
      getGemBreakdown(session.user.id),
    ]);

  const waterfall = [
    { label: "Starting grant", amount: breakdown.grants },
    { label: "Weekly allowances", amount: breakdown.allowances },
    { label: "Staked on bets", amount: -breakdown.staked },
    { label: "Payouts won", amount: breakdown.payouts },
    { label: "Refunds", amount: breakdown.refunds },
  ];

  return (
    <section className="space-y-5">
      <PageHeader title="Account" description="Your profile, balance breakdown, and full ledger." />

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex flex-col items-center rounded-xl border border-border bg-surface p-5 text-center">
            <MemberAvatar name={profile.name} size="lg" frame={cosmetics.frame} />
            <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted">
              {profile.email}
              <BadgeGlyph badge={cosmetics.badge} label="Your badge" />
            </p>
            <TitleLine title={cosmetics.title} />
            <p className="mt-1 text-xs text-faint">{profile.role.toLowerCase()}</p>
            <Link
              href={`/u/${profile.username}`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
            >
              View your profile <ExternalLink className="size-3" aria-hidden />
            </Link>
            <div className="mt-3 w-full space-y-4 border-t border-border pt-3">
              <DisplayNameForm currentName={profile.name} />
              <UsernameForm currentUsername={profile.username} />
              <BioForm currentBio={profile.bio ?? ""} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted">
              Theme <ThemeToggle />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
              <Gem className="size-3.5 text-gem" aria-hidden /> Gems
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gem">{formatPoints(gems)}</p>
            <dl className="mt-2 space-y-1 text-xs text-muted">
              {[
                { label: "Starting gems", amount: gemBreakdown.starting },
                { label: "Rake conversions", amount: gemBreakdown.rakeEarned },
                { label: "Achievements", amount: gemBreakdown.achievements },
                { label: "Season placements", amount: gemBreakdown.placements },
                ...(gemBreakdown.adjustments !== 0
                  ? [{ label: "Adjustments", amount: gemBreakdown.adjustments }]
                  : []),
                { label: "Spent in the store", amount: -gemBreakdown.spent },
              ].map((row) => (
                <div key={row.label} className="flex justify-between">
                  <dt>{row.label}</dt>
                  <dd className="font-medium tabular-nums">{formatSignedPoints(row.amount)}</dd>
                </div>
              ))}
            </dl>
            <Link
              href="/store"
              className="mt-2 inline-block text-xs font-medium text-primary hover:text-primary-hover"
            >
              Visit the store →
            </Link>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
              <Gift className="size-3.5 text-yes" aria-hidden /> Weekly allowance
            </p>
            <p className="mt-1.5 text-sm">
              {allowanceLanded ? (
                <>
                  This week&apos;s <span className="font-semibold tabular-nums">+{formatPoints(appConfig.weeklyAllowance)}</span>{" "}
                  is in. Next one {formatRelativeTime(getNextIsoWeekStart(new Date()))}.
                </>
              ) : (
                <>Show up and it lands automatically. Next reset {formatRelativeTime(getNextIsoWeekStart(new Date()))}.</>
              )}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
              <UserPlus className="size-3.5 text-primary" aria-hidden /> Invite friends
            </p>
            <p className="mt-1.5 text-sm text-muted">
              Point them at the sign-up page, then vouch so an admin lets them in faster.
            </p>
            <Link
              href="/invite"
              className="mt-2 inline-block text-xs font-medium text-primary hover:text-primary-hover"
            >
              Invite &amp; vouch →
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-faint">Current balance</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{formatPoints(breakdown.currentBalance)} pts</p>
            <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              {waterfall.map((row) => (
                <div key={row.label} className="flex justify-between">
                  <dt className="text-muted">{row.label}</dt>
                  <dd
                    className={clsx(
                      "font-medium tabular-nums",
                      row.amount > 0 ? "text-yes" : row.amount < 0 ? "text-no" : "text-faint",
                    )}
                  >
                    {formatSignedPoints(row.amount)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 font-medium">Entry</th>
                  <th className="px-4 py-2.5 font-medium">Detail</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2.5 font-medium">{TYPE_LABELS[entry.type] ?? entry.type}</td>
                    <td className="max-w-56 px-4 py-2.5 text-xs text-muted">
                      <span className="line-clamp-1">{entry.market?.title ?? entry.description}</span>
                    </td>
                    <td
                      className={clsx(
                        "px-4 py-2.5 text-right font-semibold tabular-nums",
                        entry.amount > 0 ? "text-yes" : "text-no",
                      )}
                    >
                      {formatSignedPoints(entry.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted">
                      <LocalTime date={entry.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-faint">
          <Shirt className="size-4" aria-hidden /> Locker
        </h2>
        {locker.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
            No cosmetics yet — earn gems from winning raked markets and{" "}
            <Link href="/store" className="font-medium text-primary hover:text-primary-hover">
              spend them in the store
            </Link>
            . Trophies live on{" "}
            <Link
              href={`/u/${profile.username}`}
              className="font-medium text-primary hover:text-primary-hover"
            >
              your profile
            </Link>
            .
          </div>
        ) : (
          <EquipPanel items={locker} viewerName={profile.name} />
        )}
      </div>
    </section>
  );
}
