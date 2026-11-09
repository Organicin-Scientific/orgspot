import { aggregateStats, campaignRates } from "./analytics";
import type { Campaign, CampaignStats, UpdateStatus, UpdateSummary } from "./types";

/** The update the team is working on now: one in flight beats one awaiting approval beats a draft. */
export function pickUpNext(updates: UpdateSummary[]): UpdateSummary | null {
  const order: UpdateStatus[] = ["sending", "ready", "draft"];
  for (const status of order) {
    const hit = updates.find((u) => u.status === status);
    if (hit) return hit;
  }
  return null;
}

export const UPDATE_STEPS = ["Draft", "Review", "Sending", "Sent"] as const;

/** Index into UPDATE_STEPS for an update's status. */
export function stepIndex(status: UpdateStatus): number {
  switch (status) {
    case "draft":
      return 0;
    case "ready":
      return 1;
    case "sending":
      return 2;
    default:
      return 3;
  }
}

export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

export interface MonthCell {
  key: string;
  label: string;
  sends: number;
}

/** Sends per calendar month for the trailing `months` months, oldest first. */
export function sendsByMonth(campaigns: Pick<Campaign, "approval">[], months = 12, now = new Date()): MonthCell[] {
  const cells: MonthCell[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    cells.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      sends: 0,
    });
  }
  for (const c of campaigns) {
    if (!c.approval?.approvedAt) continue;
    const d = new Date(c.approval.approvedAt);
    const cell = cells.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (cell) cell.sends++;
  }
  return cells;
}

export type HealthLevel = "healthy" | "watch" | "risk" | "unknown";

export interface HealthMetric {
  key: "delivery" | "bounce" | "complaint" | "unsubscribe";
  label: string;
  rate: number | null;
  level: HealthLevel;
  /** Plain-language threshold shown next to the number. */
  target: string;
}

function level(rate: number | null, watch: number, risk: number, higherIsWorse = true): HealthLevel {
  if (rate === null) return "unknown";
  const v = higherIsWorse ? rate : 1 - rate;
  if (v >= risk) return "risk";
  if (v >= watch) return "watch";
  return "healthy";
}

/**
 * Sender health over recent campaigns. Thresholds follow mailbox-provider guidance:
 * Gmail and Yahoo flag complaint rates above 0.3% and ask senders to stay under 0.1%;
 * bounce rates above 2% start to hurt reputation and above 5% are a list-quality problem.
 */
export function deliverabilityHealth(stats: CampaignStats[]): { overall: HealthLevel; metrics: HealthMetric[] } {
  const total = aggregateStats(stats);
  const r = campaignRates(total);
  const unsubscribeRate = total.delivered > 0 ? Math.min(1, total.unsubscribed / total.delivered) : null;
  const metrics: HealthMetric[] = [
    { key: "delivery", label: "Delivered", rate: r.deliveryRate, level: level(r.deliveryRate, 0.02, 0.05, false), target: "aim for 98%+" },
    { key: "bounce", label: "Bounced", rate: r.bounceRate, level: level(r.bounceRate, 0.02, 0.05), target: "keep under 2%" },
    { key: "complaint", label: "Spam complaints", rate: r.complaintRate, level: level(r.complaintRate, 0.001, 0.003), target: "keep under 0.1%" },
    { key: "unsubscribe", label: "Unsubscribed", rate: unsubscribeRate, level: level(unsubscribeRate, 0.01, 0.03), target: "under 1% is normal" },
  ];
  const levels = metrics.map((m) => m.level);
  const overall: HealthLevel = levels.includes("risk")
    ? "risk"
    : levels.includes("watch")
      ? "watch"
      : levels.every((l) => l === "unknown")
        ? "unknown"
        : "healthy";
  return { overall, metrics };
}

export interface FunnelStep {
  label: string;
  value: number;
  /** Share of the first step, 0..1. */
  share: number;
}

/** Accepted → delivered → opened → clicked for one campaign. */
export function engagementFunnel(s: CampaignStats): FunnelStep[] {
  const base = s.accepted || s.eligible;
  const steps: [string, number][] = [
    ["Sent", s.accepted],
    ["Delivered", s.delivered],
    ["Opened", s.opened],
    ["Clicked", s.clicked],
  ];
  return steps.map(([label, value]) => ({ label, value, share: base > 0 ? Math.min(1, value / base) : 0 }));
}

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "griffin@organicinscientific.com" → "Griffin". Falls back to an empty string for odd local parts. */
export function firstNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._+-]/)[0] ?? "";
  if (!/^[a-z]{2,}$/i.test(first)) return "";
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}
