import { createMarketAction } from "@/app/actions/markets";
import { MarketForm } from "@/components/admin/market-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminSession } from "@/lib/session";

export default async function AdminNewMarketPage() {
  await requireAdminSession();

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Create market"
        description="Create as a draft to review later, or open it for betting immediately."
      />
      <MarketForm action={createMarketAction} mode="admin" />
    </section>
  );
}
