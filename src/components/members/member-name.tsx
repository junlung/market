import clsx from "clsx";
import type { BadgeStyle } from "@/lib/cosmetics";
import { BadgeGlyph } from "@/components/members/cosmetic-renderers";
import { ProfileLink } from "@/components/members/profile-link";

/**
 * A member's name with their equipped badge, optionally linked to their
 * profile. The badge sits outside the (potentially truncating) name span so
 * it never gets clipped.
 */
export function MemberName({
  name,
  username,
  badge,
  linked = true,
  className,
  nameClassName,
}: {
  name: string;
  username?: string;
  badge?: BadgeStyle | null;
  linked?: boolean;
  className?: string;
  nameClassName?: string;
}) {
  const content = (
    <>
      <span className={clsx("min-w-0 truncate", nameClassName)}>{name}</span>
      <BadgeGlyph badge={badge} label={`${name}'s badge`} />
    </>
  );

  if (linked && username) {
    return (
      <ProfileLink username={username} className={clsx("inline-flex min-w-0 items-center gap-1", className)}>
        {content}
      </ProfileLink>
    );
  }

  return <span className={clsx("inline-flex min-w-0 items-center gap-1", className)}>{content}</span>;
}
