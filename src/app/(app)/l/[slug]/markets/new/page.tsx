import { notFound } from "next/navigation";
import { createMarketAction } from "@/app/actions/markets";
import { proposeMarketAction } from "@/app/actions/proposals";
import { MarketForm } from "@/components/admin/market-form";
import { leagueCategoryOptions } from "@/lib/categories";
import { PageHeader } from "@/components/ui/page-header";
import { canOperateLeague, getActiveSeason, getLeagueForViewer } from "@/lib/server/league-service";
import { requireSession } from "@/lib/session";

export default async function NewLeagueMarketPage({
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
  const { league } = result;

  const [canManage, season] = await Promise.all([
    canOperateLeague(league.id, session.user.id),
    getActiveSeason(league.id),
  ]);

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={canManage ? "Create a market" : "Propose a market"}
        description={
          canManage
            ? `Markets inherit ${league.name}'s rake and stake cap, and must close before the season ends.`
            : `Pitch a question to the league — the owner reviews it and opens it. Markets must close before the season ends.`
        }
      />
      {!season ? (
        <p className="rounded-xl border border-warn/40 bg-warn/5 p-4 text-sm text-muted">
          No season is running — markets can only be created during an active season.
        </p>
      ) : null}
      {/* economy fields are hidden in propose mode: custom-league markets
          always inherit the league settings (2b kickoff decision) */}
      <MarketForm
        action={canManage ? createMarketAction : proposeMarketAction}
        mode="propose"
        leagueId={league.id}
        allowOpenNow={canManage}
        submitLabel={canManage ? "Create draft" : "Submit proposal"}
        categoryOptions={leagueCategoryOptions(league.categories)}
      />
    </section>
  );
}
