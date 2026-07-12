import Link from "next/link";
import { LocalTime } from "@/components/ui/local-time";
import { ExternalLink, Gift } from "lucide-react";
import clsx from "clsx";
import { Avatar } from "@/components/ui/avatar";
import { BioForm } from "@/components/members/bio-form";
import { DisplayNameForm } from "@/components/members/display-name-form";
import { UsernameForm } from "@/components/members/username-form";
import { PageHeader } from "@/components/ui/page-header";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { appConfig } from "@/lib/config";
import { formatPoints, formatRelativeTime, formatSignedPoints } from "@/lib/format";
import { getNextIsoWeekStart } from "@/lib/allowance";
import { hasCurrentWeekAllowance } from "@/lib/server/allowance-service";
import { getSelfProfile } from "@/lib/server/member-service";
import { getBalanceBreakdown, getLedgerEntries } from "@/lib/server/market-service";
import { requireSession } from "@/lib/session";

const TYPE_LABELS: Record<string, string> = {
  INITIAL_GRANT: "Starting balance",
  WEEKLY_ALLOWANCE: "Weekly allowance",
  BET_PLACED: "Bet placed",
  MARKET_PAYOUT: "Payout",
  MARKET_REFUND: "Refund",
};

export default async function AccountPage() {
  const session = await requireSession();
  const [profile, breakdown, entries, allowanceLanded] = await Promise.all([
    getSelfProfile(session.user.id),
    getBalanceBreakdown(session.user.id),
    getLedgerEntries(session.user.id),
    hasCurrentWeekAllowance(session.user.id),
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
            <Avatar name={profile.name} size="lg" />
            <p className="text-xs text-muted mt-2">{profile.email}</p>
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
    </section>
  );
}
