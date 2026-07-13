import type { FrameStyle } from "@/lib/cosmetics";
import { Avatar } from "@/components/ui/avatar";
import { AvatarFrame } from "@/components/members/cosmetic-renderers";

/**
 * The one avatar seam for cosmetics and future avatar upgrades: renders the
 * generated-initials Avatar today, wrapped in the equipped frame. When
 * uploaded avatar images (and later the customizable character) land, they
 * swap in via `avatarNode` — frames and call sites don't change.
 */
export function MemberAvatar({
  name,
  size = "md",
  frame,
  avatarNode,
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  frame?: FrameStyle | null;
  avatarNode?: React.ReactNode;
  className?: string;
}) {
  return (
    <AvatarFrame frame={frame} size={size} className={className}>
      {avatarNode ?? <Avatar name={name} size={size} />}
    </AvatarFrame>
  );
}
