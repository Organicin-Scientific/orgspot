import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  chartAltText,
  chartAheadFrom,
  chartDefinitions,
  chartGeometry,
  parseShortUsd,
  chartTotal,
  decodeChart,
  encodeChartMonths,
  formatShortUsd,
  type RevenueChart, chartPreviewPath } from "@/lib/content/revenue-chart";
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
    // No y-axis: the figure is labelled on the line.
    expect(g.labels.map((l) => [l.name, l.value])).toEqual([["Revenue YTD", "$239K"]]);
    expect(chartDefinitions(g)).toEqual([{ name: "Revenue YTD", text: "cash paid by customers (cash basis)." }]);
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
  it("shows the chart as a signed static image whose alt text names every figure", async () => {
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
    // The token carries the trajectory: contracted ($400K) and proposed ($800K+) past August.
    expect(verifyToken("chart", token, 5)).toEqual(["2026", "0,40000,0,60000,0,0,139000,0", "#157A6E", "400000", "800000"]);
    expect(rendered.html).toContain("Revenue YTD: $239K cash received from customers, January through August 2026.");
    expect(rendered.html).toContain("Contracted backlog: $400K, signed, not yet collected (dashed line). Pipeline: $800K, proposed, not yet signed (dotted line). Both continue the line without dates.");
    // The chart carries every figure, so the email drops the backlog and pipeline rows.
    expect(rendered.html).toContain("cash paid by customers (cash basis).");
    expect(rendered.html).not.toContain("shown without dates");
    // No separate rows: the name appears in the alt text and the definitions.
    expect(rendered.html.match(/Contracted backlog/g)?.length).toBe(2);
  });
});

describe("outlook", () => {
  const chart = { year: 2026, months: [14600, 0, 700, 0, 24400, 0, 58300, 64000, 0, 21400] };

  it("reads the work ahead from the strip and ignores prompts", () => {
    expect(parseShortUsd("$121K")).toBe(121000);
    expect(parseShortUsd("$1.2M")).toBe(1200000);
    expect(parseShortUsd("$800K+")).toBe(800000);
    expect(parseShortUsd("[Write: open proposals]")).toBe(0);
    expect(chartAheadFrom([{ label: "Contracted backlog", value: "[Write: x]" }, { label: "Pipeline", value: "" }])).toBeNull();
  });

  it("stops time at the as-of month and fans signed and proposed out above the total", () => {
    const g = chartGeometry(chart, { contracted: 121000, proposed: 233000 });
    expect(g.ticks.map((t) => t.label)).toEqual(["Jan", "Oct"]);
    expect(g.ticks.at(-1)!.x).toBe(g.end.x);
    expect(g.end.x).toBeLessThan(g.width * 0.6);
    // Both lines leave from the last received point.
    expect(g.signedPath!.startsWith(`M${g.end.x} ${g.end.y}`)).toBe(true);
    expect(g.proposedPath!.startsWith(`M${g.end.x} ${g.end.y}`)).toBe(true);
    // Each line carries its own metric's figure and name; definitions go under the chart.
    expect(g.labels.map((l) => [l.value, l.name])).toEqual([
      ["$183K", "Revenue YTD"],
      ["+$121K", "Contracted backlog"],
      ["+$233K", "Pipeline"],
    ]);
    // The y-axis shows running totals, so each line's height is the sum.
    expect(g.yTicks.map((t) => t.text)).toEqual(["$200K", "$400K", "$600K"]);
    expect(chartDefinitions(g).map((d) => d.name)).toEqual(["Revenue YTD", "Contracted backlog", "Pipeline"]);
    // Proposed sits above signed, and every label stays inside the drawing.
    const [, s, p] = g.labels;
    expect(p!.nameY).toBeLessThan(s!.valueY);
    expect(Math.min(...g.labels.map((l) => l.valueY))).toBeGreaterThan(12);
  });

  it("draws only the lines that have money behind them", () => {
    const g = chartGeometry(chart, { contracted: 0, proposed: 233000 });
    expect(g.signedPath).toBeNull();
    expect(g.labels.map((l) => l.kind)).toEqual(["received", "proposed"]);
    expect(chartGeometry(chart).ticks.at(-1)).toMatchObject({ label: "Oct", anchor: "end" });
  });

  it("keeps close tails' labels apart", () => {
    const g = chartGeometry(chart, { contracted: 121000, proposed: 5000 });
    const [, s, p] = g.labels;
    expect(s!.valueY - p!.nameY).toBeGreaterThanOrEqual(12);
  });
});

describe("chartPreviewPath", () => {
  it("carries the figures the editor shows, with the work ahead when there is any", () => {
    const chart = { year: 2026, months: [14600, 0, 700] };
    expect(chartPreviewPath(chart, null)).toBe("/api/charts/revenue/preview?y=2026&m=14600%2C0%2C700");
    expect(chartPreviewPath(chart, { contracted: 121000.4, proposed: 233000 })).toBe("/api/charts/revenue/preview?y=2026&m=14600%2C0%2C700&c=121000&p=233000");
  });
});
