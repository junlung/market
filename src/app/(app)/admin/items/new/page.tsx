import { ItemForm } from "@/components/admin/item-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdminSession } from "@/lib/session";

export default async function NewItemPage() {
  await requireAdminSession();

  return (
    <section className="space-y-5">
      <PageHeader
        title="New item"
        description="Author a cosmetic or trophy. The structured fields can only produce styles the renderers can draw; the raw JSON hatch is validated the same way."
      />
      <ItemForm />
    </section>
  );
}
