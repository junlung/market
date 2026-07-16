import { AdminTabs } from "@/components/admin/admin-tabs";

// no session check here: middleware gates /admin/* by role, and every admin
// page calls requireAdminSession() itself — the layout stays query-free
export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="space-y-5">
      <AdminTabs />
      {children}
    </div>
  );
}
