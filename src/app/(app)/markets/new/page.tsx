import { createMarketAction } from "@/app/actions/markets";
import { proposeMarketAction } from "@/app/actions/proposals";
import { MarketForm } from "@/components/admin/market-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireSession } from "@/lib/session";

export default async function NewMarketPage() {
  const session = await requireSession();
  const isAdmin = session.user.role === "ADMIN";

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={isAdmin ? "Create a market" : "Propose a market"}
        description={
          isAdmin
            ? "Admins can create markets directly — as a draft or open immediately."
            : "Pitch a question to the league. An admin reviews it (mostly to make sure it can actually be resolved) and opens it."
        }
      />
      {isAdmin ? (
        <MarketForm action={createMarketAction} mode="admin" />
      ) : (
        <MarketForm action={proposeMarketAction} mode="propose" submitLabel="Submit proposal" />
      )}
    </section>
  );
}
