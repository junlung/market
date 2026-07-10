import { Skeleton } from "@/components/ui/skeleton";

export default function MarketDetailLoading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-full max-w-lg" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-14 w-32" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="hidden lg:block">
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
