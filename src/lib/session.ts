import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

/**
 * Pass `callbackUrl` (a relative path) when the page should survive the
 * sign-in round-trip — the sign-in form returns there instead of /dashboard.
 */
export async function requireSession(callbackUrl?: string) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(
      callbackUrl ? `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/sign-in",
    );
  }

  return session;
}

export async function requireAdminSession() {
  const session = await requireSession();

  if (session.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return session;
}
