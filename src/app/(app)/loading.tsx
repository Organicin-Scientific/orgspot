import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="space-y-6">
      <div className="border-b px-6 py-5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-4 px-6 py-6">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 flex-1 min-w-[12rem]" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
