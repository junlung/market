import { MarketDetailView } from "@/components/markets/market-detail-view";

type Props = {
  params: Promise<{ slug: string; marketId: string }>;
  searchParams: Promise<{ side?: string; outcome?: string; tab?: string }>;
};

export default async function LeagueMarketDetailPage({ params, searchParams }: Props) {
  const { slug, marketId } = await params;
  const { side, outcome } = await searchParams;

  return (
    <MarketDetailView
      marketId={marketId}
      side={side}
      outcomeParam={outcome}
      expectedLeagueSlug={slug}
    />
  );
}
