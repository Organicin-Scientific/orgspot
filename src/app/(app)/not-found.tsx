import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold tracking-tight">Not found</h1>
          <p className="text-sm text-muted-foreground">This item does not exist or has been deleted.</p>
        </div>
        <Button asChild>
          <Link href="/">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
