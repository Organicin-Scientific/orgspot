import { Info } from "lucide-react";

export function TrackingNote() {
  return (
    <div className="flex gap-3 rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p>
          <span className="font-medium text-foreground">How these numbers work.</span> Rates use unique recipients. Delivery and bounce rates are divided by
          emails accepted by the provider; open, click and complaint rates by emails delivered.
        </p>
        <p>
          Opens are estimates: Apple Mail Privacy Protection and some security scanners load images automatically (inflating opens), while clients that block
          images never register one. Clicks can also be triggered by link scanners. Treat engagement as directional, not exact.
        </p>
      </div>
    </div>
  );
}
