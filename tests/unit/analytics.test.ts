import { describe, expect, it } from "vitest";
import {
  aggregateStats,
  campaignRates,
  formatRate,
  ratio,
} from "../../src/lib/analytics";
import type { CampaignStats } from "../../src/lib/types";

function stats(partial: Partial<CampaignStats>): CampaignStats {
  return {
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
    ...partial,
  };
}

describe("ratio", () => {
  it("returns null when denominator is 0", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
  });

  it("returns null for non-finite inputs", () => {
    expect(ratio(Number.NaN, 1)).toBeNull();
    expect(ratio(1, Number.NaN)).toBeNull();
  });

  it("clamps result to [0, 1]", () => {
    expect(ratio(5, 10)).toBe(0.5);
    expect(ratio(-1, 10)).toBe(0);
    expect(ratio(15, 10)).toBe(1);
  });
});

describe("campaignRates", () => {
  it("uses accepted as denominator for delivery and bounce rates", () => {
    const r = campaignRates(stats({ accepted: 100, delivered: 40, bounced: 5, complained: 2, opened: 10, clicked: 3 }));
    expect(r.deliveryRate).toBe(0.4);
    expect(r.bounceRate).toBe(0.05);
  });

  it("uses delivered as denominator for complaint, open, and click rates", () => {
    const r = campaignRates(stats({ accepted: 100, delivered: 50, complained: 5, opened: 10, clicked: 5 }));
    expect(r.complaintRate).toBe(0.1);
    expect(r.openRate).toBe(0.2);
    expect(r.clickRate).toBe(0.1);
  });

  it("returns null rates when denominators are 0", () => {
    const r = campaignRates(stats({ accepted: 0, delivered: 0, opened: 1 }));
    expect(r.deliveryRate).toBeNull();
    expect(r.openRate).toBeNull();
  });
});

describe("aggregateStats", () => {
  it("sums fields then combined rates match totals (not average of per-campaign rates)", () => {
    const a = stats({ accepted: 10, delivered: 10 });
    const b = stats({ accepted: 90, delivered: 45 });
    const total = aggregateStats([a, b]);
    expect(total.accepted).toBe(100);
    expect(total.delivered).toBe(55);
    const rates = campaignRates(total);
    expect(rates.deliveryRate).toBe(0.55);
    const avgOfRates = (campaignRates(a).deliveryRate! + campaignRates(b).deliveryRate!) / 2;
    expect(avgOfRates).toBe(0.75);
    expect(rates.deliveryRate).not.toBe(avgOfRates);
  });
});

describe("formatRate", () => {
  it("formats null as em dash", () => {
    expect(formatRate(null)).toBe("—");
  });

  it("formats 0.5 as one decimal percent", () => {
    expect(formatRate(0.5)).toBe("50.0%");
  });

  it("formats zero ratio as integer percent", () => {
    expect(formatRate(0)).toBe("0%");
  });

  it("formats values at or above 99.95% as integer percent", () => {
    expect(formatRate(0.9995)).toBe("100%");
  });

  it("formats typical values below 99.95% with one decimal", () => {
    expect(formatRate(0.333)).toBe("33.3%");
  });
});
