import clsx from "clsx";

type Props = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "yes" | "no";
};

export function StatCard({ label, value, hint, tone = "default" }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p
        className={clsx(
          "mt-1.5 text-xl font-bold tabular-nums sm:text-2xl",
          tone === "yes" && "text-yes",
          tone === "no" && "text-no",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
