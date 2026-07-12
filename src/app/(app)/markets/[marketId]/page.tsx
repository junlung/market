import { MarketDetailView } from "@/components/markets/market-detail-view";

type Props = {
  params: Promise<{ marketId: string }>;
  searchParams: Promise<{ side?: string; outcome?: string; tab?: string }>;
};

export default async function MarketDetailPage({ params, searchParams }: Props) {
  const { marketId } = await params;
  const { side, outcome } = await searchParams;

  // custom-league markets redirect to their /l/[slug] home inside the view
  return <MarketDetailView marketId={marketId} side={side} outcomeParam={outcome} />;
}
