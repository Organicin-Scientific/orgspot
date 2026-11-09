import type { CampaignStats } from "./types";

export interface CampaignRates {
  /** delivered / accepted */
  deliveryRate: number | null;
  /** bounced / accepted */
  bounceRate: number | null;
  /** complained / delivered */
  complaintRate: number | null;
  /** unique opens / delivered */
  openRate: number | null;
  /** unique clicks / delivered */
  clickRate: number | null;
}

export const RATE_DEFINITIONS: Record<keyof CampaignRates, string> = {
  deliveryRate: "Recipients with a delivered event ÷ messages accepted by the email provider",
  bounceRate: "Recipients with a bounce ÷ messages accepted by the email provider",
  complaintRate: "Recipients who marked the email as spam ÷ delivered recipients",
  openRate: "Recipients with at least one recorded open ÷ delivered recipients",
  clickRate: "Recipients with at least one recorded click ÷ delivered recipients",
};

export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.min(1, Math.max(0, numerator / denominator));
}

export function campaignRates(s: CampaignStats): CampaignRates {
  return {
    deliveryRate: ratio(s.delivered, s.accepted),
    bounceRate: ratio(s.bounced, s.accepted),
    complaintRate: ratio(s.complained, s.delivered),
    openRate: ratio(s.opened, s.delivered),
    clickRate: ratio(s.clicked, s.delivered),
  };
}

/** Sum stats across campaigns, then compute rates from the totals (not an average of rates). */
export function aggregateStats(list: CampaignStats[]): CampaignStats {
  const total: CampaignStats = {
    selected: 0,
    eligible: 0,
    excluded: 0,
    accepted: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
    skipped: 0,
    unsubscribed: 0,
    opened: 0,
    clicked: 0,
  };
  for (const s of list) {
    for (const k of Object.keys(total) as (keyof CampaignStats)[]) total[k] += s[k] ?? 0;
  }
  return total;
}

export function formatRate(r: number | null): string {
  if (r === null) return "—";
  const pct = r * 100;
  return `${pct >= 99.95 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}
