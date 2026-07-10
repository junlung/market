import clsx from "clsx";

/** Thin green/red split bar showing the YES vs NO pool balance. */
export function PoolBar({
  yesPool,
  noPool,
  className,
}: {
  yesPool: number;
  noPool: number;
  className?: string;
}) {
  const total = yesPool + noPool;
  const yesShare = total > 0 ? (yesPool / total) * 100 : 50;

  return (
    <div
      className={clsx("flex h-1 w-full gap-[2px] overflow-hidden rounded-full", className)}
      role="img"
      aria-label={`Yes pool ${yesPool} points, No pool ${noPool} points`}
    >
      <div className="rounded-full bg-yes" style={{ width: `${yesShare}%` }} />
      <div className="flex-1 rounded-full bg-no" />
    </div>
  );
}
