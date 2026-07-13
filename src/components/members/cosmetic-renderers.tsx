import clsx from "clsx";
import type { BadgeStyle, BannerStyle, FrameStyle, TitleStyle } from "@/lib/cosmetics";

/**
 * Pure presentational renderers for equipped cosmetics. No "use client" and
 * no server imports — the same components render in server pages, client
 * tables, and the (3b) admin live preview. Styles arrive pre-parsed
 * (hex-locked by src/lib/cosmetics.ts), so inline `style` values here are
 * safe by construction.
 */

type AvatarSize = "xs" | "sm" | "md" | "lg";

// ring inset / glow blur scaled to the avatar size; the ring layer is
// absolutely positioned so tight table rows keep their exact dimensions —
// the decoration bleeds into existing gap gutters instead of adding layout
const FRAME_GEOMETRY: Record<AvatarSize, { inset: string; blur: number }> = {
  xs: { inset: "-inset-[2px]", blur: 6 },
  sm: { inset: "-inset-[2px]", blur: 8 },
  md: { inset: "-inset-[3px]", blur: 10 },
  lg: { inset: "-inset-[3px]", blur: 14 },
};

/** Wraps any avatar node in an equipped frame (ring + optional glow). */
export function AvatarFrame({
  frame,
  size = "md",
  children,
  className,
}: {
  frame: FrameStyle | null | undefined;
  size?: AvatarSize;
  children: React.ReactNode;
  className?: string;
}) {
  if (!frame) {
    return <>{children}</>;
  }

  const geometry = FRAME_GEOMETRY[size];
  const ringBackground = frame.ring2
    ? `conic-gradient(${frame.ring}, ${frame.ring2}, ${frame.ring})`
    : frame.ring;

  return (
    <span className={clsx("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={clsx(
          "absolute rounded-full",
          geometry.inset,
          frame.animate === "pulse" && "animate-pulse",
        )}
        style={{
          background: ringBackground,
          ...(frame.glow ? { boxShadow: `0 0 ${geometry.blur}px ${frame.glow}` } : {}),
        }}
      />
      <span className="relative inline-flex">{children}</span>
    </span>
  );
}

/** Inline badge glyph next to a name. Keep it OUTSIDE truncating spans. */
export function BadgeGlyph({
  badge,
  label,
  className,
}: {
  badge: BadgeStyle | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!badge) {
    return null;
  }
  return (
    <span
      className={clsx("inline-block shrink-0 text-[0.95em] leading-none", className)}
      title={label}
      aria-label={label}
    >
      {badge.glyph}
    </span>
  );
}

/** Equipped title — roomy surfaces only (profile header, podium). */
export function TitleLine({
  title,
  className,
}: {
  title: TitleStyle | null | undefined;
  className?: string;
}) {
  if (!title) {
    return null;
  }

  const gradient = title.gradient
    ? { backgroundImage: `linear-gradient(90deg, ${title.gradient[0]}, ${title.gradient[1]})` }
    : null;

  return (
    <span
      className={clsx(
        "text-xs font-medium tracking-wide",
        gradient && "bg-clip-text text-transparent",
        !gradient && !title.color && "text-muted",
        className,
      )}
      style={gradient ?? (title.color ? { color: title.color } : undefined)}
    >
      {title.text}
    </span>
  );
}

const BANNER_DIRECTION: Record<NonNullable<BannerStyle["direction"]>, string> = {
  "to-r": "90deg",
  "to-br": "135deg",
  "to-b": "180deg",
};

/**
 * The profile identity-header backdrop (BACKGROUND slot). Renders a gradient
 * band behind the header's top edge plus an empty scene mount — the reserved
 * anchor for the future avatar-character / 3D showcase (see the Phase 3 plan).
 * Without a banner it renders children in the plain card, unchanged.
 */
export function ProfileBanner({
  banner,
  children,
  className,
}: {
  banner: BannerStyle | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  if (!banner) {
    return <div className={className}>{children}</div>;
  }

  const angle = BANNER_DIRECTION[banner.direction ?? "to-r"];

  return (
    <div className={clsx("relative overflow-hidden", className)}>
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-20"
        style={{ backgroundImage: `linear-gradient(${angle}, ${banner.from}, ${banner.to})` }}
      >
        {/* fade into the card surface so text below stays readable in both themes */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-surface" />
        <div data-scene-mount className="absolute inset-0" />
      </div>
      <div className="relative pt-10">{children}</div>
    </div>
  );
}
