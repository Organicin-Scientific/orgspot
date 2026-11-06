"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-svh bg-zinc-950 text-zinc-100 antialiased">
        <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 py-12">
          <div className="max-w-md space-y-2 text-center">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-zinc-400">The app hit an unexpected error. Try reloading the page.</p>
            {error.digest && (
              <p className="pt-1 font-mono text-xs text-zinc-500">
                Reference: <span className="select-all">{error.digest}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
