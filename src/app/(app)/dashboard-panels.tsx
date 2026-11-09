import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleCheck, FileText, Send } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { NewUpdateButton } from "@/components/new-update-button";
import { Button } from "@/components/ui/button";
import { campaignRates, formatRate } from "@/lib/analytics";
import {
  daysSince,
  deliverabilityHealth,
  engagementFunnel,
  sendsByMonth,
  stepIndex,
  UPDATE_STEPS,
  type HealthLevel,
} from "@/lib/dashboard";
import { formatDate, formatNumber, relativeTime } from "@/lib/format";
import type { AuditLog, Campaign, UpdateSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ---------- Shared pieces ---------- */

function Panel({
  index,
  className,
  title,
  action,
  children,
}: {
  index: number;
  className?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("dash-enter flex flex-col rounded-2xl border bg-card p-5", className)} style={{ "--i": index } as React.CSSProperties}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/* ---------- Up next ---------- */

export function UpNextPanel({
  update,
  campaign,
  lastSentAt,
  index,
}: {
  update: UpdateSummary | null;
  campaign: Campaign | null;
  lastSentAt: string | null;
  index: number;
}) {
  if (!update) {
    const days = daysSince(lastSentAt);
    return (
      <Panel index={index} className="justify-between lg:col-span-2" title="Up next">
        <div className="flex flex-1 flex-col items-start justify-center gap-4 py-4">
          <div className="space-y-1.5">
            <p className="text-xl font-semibold tracking-tight">Nothing in progress</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {days === null
                ? "Start your first investor update. The template gives you the standard sections to fill in."
                : `Your last update went out ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}. Start the next one from the template.`}
            </p>
          </div>
          <NewUpdateButton label="Start the next update" />
        </div>
      </Panel>
    );
  }

  const step = stepIndex(update.status);
  const href =
    update.status === "ready" && update.pendingCampaignId
      ? `/updates/${update.id}/send`
      : update.status === "sending" && update.sentCampaignId
        ? `/analytics/${update.sentCampaignId}`
        : `/updates/${update.id}`;
  const cta = update.status === "ready" ? "Review and send" : update.status === "sending" ? "View progress" : "Continue writing";
  const progress =
    update.status === "sending" && campaign && campaign.stats.eligible > 0
      ? Math.min(1, (campaign.stats.accepted + campaign.stats.failed + campaign.stats.skipped) / campaign.stats.eligible)
      : null;

  return (
    <Panel index={index} className="lg:col-span-2" title="Up next" action={<StatusBadge status={update.status} />}>
      <div className="flex flex-1 flex-col justify-between gap-6">
        <div className="space-y-1.5">
          <Link href={`/updates/${update.id}`} className="block text-xl font-semibold tracking-tight hover:underline">
            {update.title || "Untitled update"}
          </Link>
          <p className="text-sm text-muted-foreground">
            {update.subject ? <span className="text-foreground/80">“{update.subject}”</span> : "No subject yet"} · edited{" "}
            {relativeTime(update.updatedAt)} by {update.updatedBy}
          </p>
        </div>

        <ol className="grid grid-cols-4 gap-2" aria-label="Progress">
          {UPDATE_STEPS.map((label, i) => (
            <li key={label} className="space-y-2">
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("dash-bar h-full rounded-full", i <= step ? "bg-brand" : "bg-transparent")}
                  style={{ "--i": i } as React.CSSProperties}
                />
              </div>
              <p className={cn("text-xs", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>
                {label}
                {i === step && <span className="sr-only"> (current step)</span>}
              </p>
            </li>
          ))}
        </ol>

        {progress !== null && campaign && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {formatNumber(campaign.stats.accepted)} of {formatNumber(campaign.stats.eligible)} sent
              </span>
              <span className="tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand transition-transform duration-300" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}

        <div>
          <Button asChild className="pressable">
            <Link href={href}>
              {cta}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- Cadence and audience ---------- */

export function CadencePanel({
  lastSentAt,
  months,
  active,
  total,
  unsubscribed,
  bounced,
  index,
}: {
  lastSentAt: string | null;
  months: ReturnType<typeof sendsByMonth>;
  active: number;
  total: number;
  unsubscribed: number;
  bounced: number;
  index: number;
}) {
  const days = daysSince(lastSentAt);
  const max = Math.max(1, ...months.map((m) => m.sends));
  return (
    <Panel index={index} title="Cadence">
      {days === null ? (
        <p className="text-lg font-semibold tracking-tight">No updates sent yet</p>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums tracking-tight">{days}</span>
          <span className="text-sm text-muted-foreground">day{days === 1 ? "" : "s"} since last update</span>
        </div>
      )}
      {lastSentAt && <p className="mt-1 text-xs text-muted-foreground">Sent {formatDate(lastSentAt)}</p>}

      <div className="mt-5" role="img" aria-label={`Updates sent per month: ${months.map((m) => `${m.label} ${m.sends}`).join(", ")}`}>
        <div className="flex h-12 items-end gap-1">
          {months.map((m, i) => (
            <div key={m.key} className="flex h-full flex-1 items-end">
              <div
                className={cn("dash-bar-v w-full rounded-sm", m.sends > 0 ? "bg-brand" : "bg-muted")}
                style={{ height: m.sends > 0 ? `${Math.max(30, (m.sends / max) * 100)}%` : "12%", "--i": i } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>{months[0]?.label}</span>
          <span>{months[months.length - 1]?.label}</span>
        </div>
      </div>

      <div className="mt-auto border-t pt-4">
        <Link href="/investors" className="pressable -mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/60">
          <div>
            <p className="text-sm font-medium tabular-nums">
              {formatNumber(active)} active investor{active === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(total)} contacts · {formatNumber(unsubscribed)} unsubscribed · {formatNumber(bounced)} bounced
            </p>
          </div>
          <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </div>
    </Panel>
  );
}

/* ---------- Last send ---------- */

export function LastSendPanel({ campaign, trend, index }: { campaign: Campaign | null; trend: Campaign[]; index: number }) {
  if (!campaign) {
    return (
      <Panel index={index} className="lg:col-span-2" title="Last update">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Send className="size-5" aria-hidden />
          Engagement for your most recent update shows here once it has been sent.
        </div>
      </Panel>
    );
  }
  const funnel = engagementFunnel(campaign.stats);
  const rates = campaignRates(campaign.stats);
  const trendRates = trend.map((c) => ({ id: c.id, title: c.title, rate: campaignRates(c.stats).openRate }));
  return (
    <Panel index={index} className="lg:col-span-2" title="Last update" action={<PanelLink href={`/analytics/${campaign.id}`}>Full report</PanelLink>}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link href={`/analytics/${campaign.id}`} className="text-base font-semibold tracking-tight hover:underline">
          {campaign.title || "Untitled update"}
        </Link>
        <span className="text-xs text-muted-foreground">
          Sent {formatDate(campaign.approval?.approvedAt)} to {formatNumber(campaign.stats.eligible)}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_200px]">
        <dl className="space-y-3" aria-label="Recipients at each step, with share of messages sent">
          {funnel.map((s, i) => (
            <div key={s.label} className="grid grid-cols-[80px_1fr_72px] items-center gap-3 text-sm">
              <dt className="text-muted-foreground">{s.label}</dt>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="dash-bar h-full rounded-full bg-brand"
                  style={{ width: `${Math.max(s.value > 0 ? 2 : 0, s.share * 100)}%`, opacity: 1 - i * 0.18, "--i": i } as React.CSSProperties}
                />
              </div>
              <dd className="text-right tabular-nums">
                {formatNumber(s.value)}
                {i > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{formatRate(s.share)}</span>}
              </dd>
            </div>
          ))}
        </dl>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-muted-foreground">Open rate, last {trendRates.length}</p>
            <p className="text-sm font-medium tabular-nums" title="Opened ÷ delivered">
              {formatRate(rates.openRate)}
            </p>
          </div>
          <div className="flex h-20 items-end gap-1.5" role="img" aria-label={`Open rates: ${trendRates.map((t) => formatRate(t.rate)).join(", ")}`}>
            {trendRates.map((t, i) => (
              <div key={t.id} className="flex h-full flex-1 items-end" title={`${t.title}: ${formatRate(t.rate)}`}>
                <div
                  className={cn("dash-bar-v w-full rounded-sm", i === trendRates.length - 1 ? "bg-brand" : "bg-brand/35")}
                  style={{ height: `${Math.max(6, (t.rate ?? 0) * 100)}%`, "--i": i } as React.CSSProperties}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Opens are estimates; Apple Mail pre-loads images. {formatRate(rates.clickRate)} clicked.
          </p>
        </div>
      </div>
    </Panel>
  );
}

/* ---------- Deliverability health ---------- */

const HEALTH_COPY: Record<HealthLevel, { label: string; tone: string; dot: string }> = {
  healthy: { label: "Healthy", tone: "text-success", dot: "bg-success" },
  watch: { label: "Watch", tone: "text-amber-700 dark:text-warning", dot: "bg-warning" },
  risk: { label: "At risk", tone: "text-destructive", dot: "bg-destructive" },
  unknown: { label: "No data yet", tone: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

export function HealthPanel({ health, sampled, index }: { health: ReturnType<typeof deliverabilityHealth>; sampled: number; index: number }) {
  const overall = HEALTH_COPY[health.overall];
  return (
    <Panel index={index} title="Deliverability" action={<PanelLink href="/investors/suppression">Suppression list</PanelLink>}>
      <div className="flex items-center gap-2">
        {health.overall === "healthy" ? (
          <CircleCheck className="size-5 text-success" aria-hidden />
        ) : (
          <span className={cn("size-2.5 rounded-full", overall.dot)} aria-hidden />
        )}
        <span className={cn("text-lg font-semibold tracking-tight", overall.tone)}>{overall.label}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {sampled > 0 ? `Across your last ${sampled} update${sampled === 1 ? "" : "s"}` : "Shows once an update has been sent"}
      </p>
      <ul className="mt-4 divide-y">
        {health.metrics.map((m) => (
          <li key={m.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span className={cn("size-1.5 rounded-full", HEALTH_COPY[m.level].dot)} aria-hidden />
              <span>{m.label}</span>
              <span className="sr-only">{HEALTH_COPY[m.level].label}</span>
            </div>
            <div className="text-right">
              <span className="tabular-nums">{formatRate(m.rate)}</span>
              <span className="ml-2 hidden text-xs text-muted-foreground xl:inline">{m.target}</span>
            </div>
          </li>
        ))}
      </ul>
      <Link href="/settings" className="mt-auto pt-3 text-xs text-muted-foreground transition-colors hover:text-foreground">
        Check domain authentication in Settings
      </Link>
    </Panel>
  );
}

/* ---------- Recent updates ---------- */

export function RecentPanel({ updates, index }: { updates: UpdateSummary[]; index: number }) {
  return (
    <Panel index={index} className="lg:col-span-2" title="Recent updates" action={<PanelLink href="/updates">All updates</PanelLink>}>
      {updates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <FileText className="size-5" aria-hidden />
          Past updates appear here.
        </div>
      ) : (
        <ul className="-mx-2">
          {updates.map((u) => (
            <li key={u.id}>
              <Link
                href={u.sentCampaignId ? `/analytics/${u.sentCampaignId}` : `/updates/${u.id}`}
                className="pressable flex items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.title || "Untitled update"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {u.sentAt ? `Sent ${formatDate(u.sentAt)}` : `Edited ${relativeTime(u.updatedAt)} by ${u.updatedBy}`}
                  </div>
                </div>
                <StatusBadge status={u.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- Activity ---------- */

export function ActivityPanel({ activity, index }: { activity: AuditLog[]; index: number }) {
  return (
    <Panel index={index} title="Activity">
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="relative space-y-4 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3.5px] before:w-px before:bg-border">
          {activity.map((a) => (
            <li key={a.id} className="relative flex gap-3 text-sm">
              <span className="relative mt-1 size-2 shrink-0 rounded-full bg-brand/70 ring-4 ring-card" aria-hidden />
              <div className="min-w-0">
                <p className="leading-snug">{a.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {a.actorEmail === "recipient" ? "Recipient" : a.actorEmail === "system" ? "System" : a.actorEmail.split("@")[0]} ·{" "}
                  {relativeTime(a.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
