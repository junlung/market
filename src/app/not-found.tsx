import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold">404 — resolved No.</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Whatever you were betting on finding here, it didn&apos;t hit. All stakes refunded.
      </p>
      <Link href="/dashboard" className={`mt-6 ${buttonClasses("primary", "md")}`}>
        Back to the action
      </Link>
    </main>
  );
}
