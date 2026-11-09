import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-amber-700 dark:text-warning",
  danger: "bg-destructive/10 text-destructive",
  brand: "bg-brand/10 text-brand",
};

const LABELS: Record<string, [string, Tone]> = {
  // investors
  active: ["Active", "success"],
  unsubscribed: ["Unsubscribed", "neutral"],
  bounced: ["Bounced", "danger"],
  complained: ["Complained", "danger"],
  suppressed: ["Suppressed", "warning"],
  // updates
  draft: ["Draft", "neutral"],
  ready: ["Awaiting confirmation", "info"],
  sending: ["Sending", "brand"],
  sent: ["Sent", "success"],
  failed: ["Failed", "danger"],
  // campaigns
  pending_approval: ["Awaiting confirmation", "info"],
  queued: ["Queued", "neutral"],
  partially_failed: ["Partially failed", "warning"],
  cancelled: ["Cancelled", "neutral"],
  // recipients
  retry_wait: ["Retrying", "warning"],
  accepted: ["Accepted", "info"],
  delivered: ["Delivered", "success"],
  skipped: ["Skipped", "neutral"],
  needs_review: ["Needs review", "warning"],
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const [label, tone] = LABELS[status] ?? [status.replace(/_/g, " "), "neutral" as Tone];
  return (
    <span className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-xs font-medium", TONES[tone], className)}>
      {label}
    </span>
  );
}
