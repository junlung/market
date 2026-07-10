import clsx from "clsx";

const HUES = [212, 262, 340, 20, 158, 45, 190, 300];

function hashName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const hue = HUES[hashName(name) % HUES.length];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  const sizeClass = {
    xs: "size-5 text-[9px]",
    sm: "size-7 text-[10px]",
    md: "size-9 text-xs",
    lg: "size-14 text-lg",
  }[size];

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
        sizeClass,
        className,
      )}
      style={{ backgroundColor: `oklch(0.55 0.13 ${hue})` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
