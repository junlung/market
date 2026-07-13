import { notFound } from "next/navigation";
import { UserStatus } from "@prisma/client";
import { GrantItemForm } from "@/components/admin/grant-item-form";
import { ItemForm } from "@/components/admin/item-form";
import { PageHeader } from "@/components/ui/page-header";
import { getItemById } from "@/lib/server/item-service";
import { getMembersOverview } from "@/lib/server/member-service";
import { requireAdminSession } from "@/lib/session";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  await requireAdminSession();
  const { itemId } = await params;
  const [item, members] = await Promise.all([getItemById(itemId), getMembersOverview()]);

  if (!item) {
    notFound();
  }

  const activeMembers = members
    .filter((member) => member.status === UserStatus.ACTIVE)
    .map((member) => ({ id: member.id, name: member.name }));

  return (
    <section className="space-y-5">
      <PageHeader
        title={item.name}
        description={`${item.slug} · owned by ${item._count.userItems} member${item._count.userItems === 1 ? "" : "s"}`}
      />

      <ItemForm
        item={{
          id: item.id,
          slug: item.slug,
          name: item.name,
          description: item.description,
          kind: item.kind,
          storeCost: item.storeCost,
          active: item.active,
          style: item.style,
        }}
      />

      <div className="max-w-md rounded-xl border border-border bg-surface p-4">
        <GrantItemForm itemId={item.id} members={activeMembers} />
      </div>
    </section>
  );
}
