import clsx from "clsx";

type Props = {
  label: string;
};

const colorMap: Record<string, string> = {
  open: "bg-yes-bg text-yes",
  proposed: "bg-primary/10 text-primary",
  draft: "bg-warn/10 text-warn",
  rejected: "bg-surface-2 text-faint",
  closed: "bg-surface-2 text-muted",
  resolved: "bg-resolved/10 text-resolved",
  canceled: "bg-no-bg text-no",
  yes: "bg-yes-bg text-yes",
  no: "bg-no-bg text-no",
  won: "bg-yes-bg text-yes",
  lost: "bg-no-bg text-no",
  refunded: "bg-surface-2 text-muted",
  active: "bg-yes-bg text-yes",
  vouched: "bg-yes-bg text-yes",
  pending: "bg-warn/10 text-warn",
};

export function StatusBadge({ label }: Props) {
  const normalized = label.toLowerCase();
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        colorMap[normalized] ?? colorMap.pending,
      )}
    >
      {label}
    </span>
  );
}
