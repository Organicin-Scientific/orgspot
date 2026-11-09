"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 py-12">
      <div className="w-full max-w-md space-y-2 text-center">
        <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">We could not load this page. You can try again, or go back using the sidebar.</p>
        {error.digest && (
          <p className="pt-1 font-mono text-xs text-muted-foreground">
            Reference: <span className="select-all">{error.digest}</span>
          </p>
        )}
      </div>
      <Button type="button" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
