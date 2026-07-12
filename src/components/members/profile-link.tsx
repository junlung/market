import Link from "next/link";
import clsx from "clsx";

/**
 * Wraps a member's avatar/name anywhere it renders and links it to their
 * profile. Keep the hover affordance consistent — this is what makes
 * profiles discoverable.
 */
export function ProfileLink({
  username,
  className,
  children,
}: {
  username: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/u/${username}`}
      className={clsx("transition-colors hover:text-primary", className)}
    >
      {children}
    </Link>
  );
}
