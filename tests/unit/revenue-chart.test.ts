import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  chartAltText,
  chartGeometry,
  chartTotal,
  decodeChart,
  encodeChartMonths,
  formatShortUsd,
  type RevenueChart,
} from "@/lib/content/revenue-chart";
import { parseDoc, type DocNode } from "@/lib/content/schema";
import {
  metricDisplayValue,
  migrateLegacyMetrics,
  PROMPT_OPEN,
  revenueChartGaps,
  starterDocument,
  templatePromptCount,
} from "@/lib/content/template";
import { docToPlainText } from "@/lib/content/plain-text";
import { defaultSettings } from "@/server/db/settings";

vi.mock("@/server/storage", () => ({
  assetUrl: (id: string) => `https://app.example.test/api/assets/${id}`,
  loadAssetBuffers: async () => new Map(),
}));

beforeAll(() => {
  Object.assign(process.env, {
    APP_URL: "https://app.example.test",
    FIREBASE_PROJECT_ID: "demo-organicin",
    FIREBASE_STORAGE_BUCKET: "demo-organicin.appspot.com",
    CRON_SECRET: "x".repeat(32),
    TOKEN_SIGNING_SECRET: "y".repeat(32),
  });
});

const chart: RevenueChart = { year: 2026, months: [0, 40_000, 0, 60_000, 0, 0, 139_000, 0] };

function strip(items: unknown[]): DocNode {
  return { type: "doc", content: [{ type: "metrics", attrs: { items } }] } as DocNode;
}

describe("revenue chart", () => {
  it("formats short dollar values", () => {
    expect(formatShortUsd(950)).toBe("$950");
    expect(formatShortUsd(122_300)).toBe("$122K");
    expect(formatShortUsd(22_340)).toBe("$22.3K");
    expect(formatShortUsd(239_000)).toBe("$239K");
    expect(formatShortUsd(1_200_000)).toBe("$1.2M");
    expect(formatShortUsd(999_800)).toBe("$1M");
  });

  it("ends the line at the YTD total and states it in the alt text", () => {
    expect(chartTotal(chart)).toBe(239_000);
    const g = chartGeometry(chart);
    // Eight months plotted: nine points including January 1 at $0.
    expect(g.linePath.split(/[ML]/).filter(Boolean)).toHaveLength(9);
    // The x-axis ends at the as-of month, so the line reaches the right edge.
    expect(g.end.x).toBeGreaterThan(g.width - 10);
    expect(g.end.y).toBeLessThan(g.baseY);
    expect(g.ticks.map((t) => t.label)).toEqual(["Jan", "Aug"]);
    expect(chartGeometry({ year: 2026, months: [5_000] }).ticks.map((t) => t.label)).toEqual(["Jan"]);
    expect(g.yLabel.text).toBe("$250K");
    expect(chartAltText(chart)).toBe("Revenue YTD: $239K cash received from customers, January through August 2026.");
  });

  it("round-trips through the image URL and rejects malformed figures", () => {
    expect(decodeChart("2026", encodeChartMonths(chart))).toEqual(chart);
    expect(decodeChart("2026", "1,-2")).toBeNull();
    expect(decodeChart("1999", "1")).toBeNull();
    expect(decodeChart("2026", Array(13).fill(1).join(","))).toBeNull();
  });

  it("derives the headline from the chart, so number and line agree", () => {
    const item = { label: "Revenue YTD", sublabel: "cash received since Jan 1", value: "$1", chart };
    expect(metricDisplayValue(item)).toBe("$239K");
    expect(docToPlainText(strip([item]))).toContain("Revenue YTD (cash received since Jan 1): $239K");
    expect(parseDoc(strip([item])).ok).toBe(true);
  });
});

describe("standing strip", () => {
  it("starts Revenue YTD on the Mercury prompt, which blocks investor sends", () => {
    const metrics = starterDocument().content.find((b) => b.type === "metrics");
    expect(metrics?.type === "metrics" && metrics.attrs.items[0].value).toBe(`${PROMPT_OPEN}Revenue YTD from Mercury]`);
    expect(templatePromptCount(strip([{ label: "Revenue YTD", sublabel: "", value: `${PROMPT_OPEN}Revenue YTD from Mercury]` }]))).toBe(1);
  });

  it("flags a Revenue YTD value with no monthly figures behind it", () => {
    expect(revenueChartGaps(strip([{ label: "Revenue YTD", sublabel: "", value: "$239K" }]))).toBe(1);
    expect(revenueChartGaps(strip([{ label: "Revenue YTD", sublabel: "", value: "$239K", chart }]))).toBe(0);
    expect(revenueChartGaps(strip([{ label: "Revenue YTD", sublabel: "", value: `${PROMPT_OPEN}x]` }]))).toBe(0);
  });

  it("swaps a draft's retired cards for the standing strip and its prompts", () => {
    const legacy = strip([
      { label: "Revenue this quarter", sublabel: "", value: "$122.3K" },
      { label: "Contracts signed", sublabel: "", value: "$239K" },
      { label: "Pipeline", sublabel: "next two quarters", value: "$800K+" },
    ]);
    const migrated = migrateLegacyMetrics(legacy);
    const m = migrated.content[0];
    expect(m.type === "metrics" && m.attrs.items.map((i) => [i.label, i.sublabel, i.value])).toEqual([
      ["Revenue YTD", "cash received since Jan 1", `${PROMPT_OPEN}Revenue YTD from Mercury]`],
      ["Contracted backlog", "signed, not yet collected", `${PROMPT_OPEN}uncollected contract value]`],
      ["Pipeline", "proposed, not yet signed", `${PROMPT_OPEN}open proposals]`],
    ]);
    const current = starterDocument();
    expect(migrateLegacyMetrics(current)).toBe(current);
  });
});

describe("email", () => {
  it("shows the chart as a signed static image with alt text, beside the hero figure", async () => {
    const { renderUpdateEmail } = await import("@/server/email/render");
    const { verifyToken } = await import("@/server/tokens");
    const rendered = await renderUpdateEmail({
      title: "Q3 2026",
      subject: "Q3 2026",
      previewText: "",
      content: strip([
        { label: "Revenue YTD", sublabel: "cash received since Jan 1", value: "$239K", chart },
        { label: "Contracted backlog", sublabel: "signed, not yet collected", value: "$400K" },
        { label: "Pipeline", sublabel: "proposed, not yet signed", value: "$800K+" },
      ]),
      bannerAssetId: null,
      pdfDelivery: "none",
      attachments: [],
      settings: defaultSettings(),
      mode: "campaign",
    });
    expect(rendered.html).not.toMatch(/<script/i);
    const src = rendered.html.match(/src="(https:\/\/app\.example\.test\/api\/charts\/revenue\?c=[^"]+)"/)?.[1];
    expect(src).toBeTruthy();
    const token = decodeURIComponent(new URL(src!.replace(/&amp;/g, "&")).searchParams.get("c")!);
    expect(verifyToken("chart", token, 3)).toEqual(["2026", "0,40000,0,60000,0,0,139000,0", "#157A6E"]);
    expect(rendered.html).toContain('alt="Revenue YTD: $239K cash received from customers, January through August 2026."');
    // Ledger card: chart cell beside the hero figure, then the other figures as rows.
    expect(rendered.html).toContain('width="46%"');
    expect(rendered.html.indexOf("$239K")).toBeLessThan(rendered.html.indexOf("Contracted backlog"));
    expect(rendered.html.indexOf("Contracted backlog")).toBeLessThan(rendered.html.indexOf("$400K"));
  });
});
