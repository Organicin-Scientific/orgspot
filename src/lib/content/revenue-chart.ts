/**
 * The Revenue YTD chart: cumulative customer cash by month, January through the update's
 * as-of month. One geometry function feeds the editor, the email image and the PDF, so the
 * three draw the same picture.
 *
 * Authors enter the cash received in each month (what Mercury shows); the chart plots the
 * running total, starting at $0 on January 1. The last point is the YTD total, and the card's
 * headline value is always derived from it, so the number and the line cannot disagree.
 */

export interface RevenueChart {
  /** Calendar year the figures cover. */
  year: number;
  /** Customer cash received in each month, January first. Length = the as-of month (1 to 12). */
  months: number[];
}

/**
 * Business not yet received, drawn past the as-of month: dashed for signed contracts not yet
 * collected, dotted for proposals not yet signed. These segments carry no dates; the time
 * axis stops at the as-of month, so the chart makes no claim about when the money arrives.
 */
export interface ChartAhead {
  contracted: number;
  proposed: number;
}

export const REVENUE_YTD_LABEL = "Revenue YTD";
export const CONTRACTED_LABEL = "Contracted backlog";
export const PIPELINE_LABEL = "Pipeline";

/** "$121K" → 121000, "$1.2M" → 1200000, "$800K+" → 800000. A prompt or junk reads as 0. */
export function parseShortUsd(text: string | undefined): number {
  if (!text || text.includes("[Write:")) return 0;
  const m = text.replace(/[,\s]/g, "").match(/^\$?(\d+(?:\.\d+)?)([KMB])?\+?$/i);
  if (!m) return 0;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

/** The trajectory's undated segments, read from the strip's other cards. Null when both are empty. */
export function chartAheadFrom(items: { label: string; value: string }[]): ChartAhead | null {
  const value = (label: string) => parseShortUsd(items.find((m) => m.label === label)?.value);
  const ahead = { contracted: value(CONTRACTED_LABEL), proposed: value(PIPELINE_LABEL) };
  return ahead.contracted > 0 || ahead.proposed > 0 ? ahead : null;
}
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function hasChartData(chart: RevenueChart | undefined | null): chart is RevenueChart {
  return !!chart && Array.isArray(chart.months) && chart.months.length > 0;
}

export function chartTotal(chart: RevenueChart): number {
  return chart.months.reduce((sum, v) => sum + (Number.isFinite(v) ? Math.max(0, v) : 0), 0);
}

/** Investor-facing short dollar figure: $950, $122.3K, $239K, $1.2M. */
export function formatShortUsd(n: number): string {
  const v = Math.max(0, Math.round(n));
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (v < 1_000) return `$${v}`;
  if (v < 100_000) return `$${trim(v / 1_000)}K`;
  if (v < 999_500) return `$${Math.round(v / 1_000)}K`;
  if (v < 1_000_000_000) return `$${trim(v / 1_000_000)}M`;
  return `$${trim(v / 1_000_000_000)}B`;
}

/** Alt text for the static image: every figure the chart labels, and that the work ahead has no dates. */
export function chartAltText(chart: RevenueChart, ahead: ChartAhead | null = null): string {
  const last = MONTH_NAMES[chart.months.length - 1];
  const period = chart.months.length === 1 ? `January ${chart.year}` : `January through ${last} ${chart.year}`;
  const received = toK(chartTotal(chart));
  const base = `Revenue YTD: ${formatShortUsd(received)} cash received from customers, ${period}.`;
  if (!ahead) return base;
  const signedAdd = toK(ahead.contracted);
  const proposedAdd = toK(ahead.proposed);
  const parts = [
    signedAdd > 0 ? `${formatShortUsd(received + signedAdd)} with ${formatShortUsd(signedAdd)} of signed work not yet collected (dashed line).` : "",
    proposedAdd > 0 ? `${formatShortUsd(received + signedAdd + proposedAdd)} with ${formatShortUsd(proposedAdd)} of proposals not yet signed (dotted line).` : "",
  ].filter(Boolean);
  return parts.length ? `${base} ${parts.join(" ")} The signed and proposed work has no dates.` : base;
}

// ---------------------------------------------------------------------------
// Geometry

/**
 * Drawing size in CSS pixels. The chart is the body of the metrics card: one line for cash
 * received, which then fans into signed (dashed) and proposed (dotted) work. The email image
 * is rendered at 2x for sharp screens; the editor switches to the narrow size in tight columns.
 */
export const CHART_SIZE = { width: 420, height: 240 } as const;
export const CHART_SIZE_NARROW = { width: 320, height: 240 } as const;

export interface ChartTick {
  x: number;
  label: string;
  /** "start" hangs the label right of x, "middle" centres it, "end" sits left of it. */
  anchor: "start" | "middle" | "end";
}

/** A direct label: a bold figure above a short line of text, right-aligned to x. */
export interface ChartLabel {
  kind: "received" | "signed" | "proposed";
  x: number;
  /** Baselines of the figure and the line under it. */
  valueY: number;
  subY: number;
  value: string;
  sub: string;
}

export interface ChartGeometry {
  width: number;
  height: number;
  /** Bottom of the plot, where the baseline sits. */
  baseY: number;
  linePath: string;
  areaPath: string;
  end: { x: number; y: number };
  /** Dashed: received plus signed work not yet collected. Null when there is none. */
  signedPath: string | null;
  /** Dotted: received plus signed plus proposed work. Null when there is none. */
  proposedPath: string | null;
  labels: ChartLabel[];
  /** January at the left, the as-of month where the received line ends. Nothing after it. */
  ticks: ChartTick[];
}

const f = (n: number) => Number(n.toFixed(2));
/** Labels show thousands, so totals are sums of the shown figures: $183K + $121K reads $304K. */
const toK = (n: number) => Math.round(Math.max(0, n) / 1000) * 1000;

/** Line weights, dash patterns and label type, shared by every renderer. */
export const CHART_STYLE = {
  stroke: 2.4,
  dot: 4.6,
  dotRing: 2,
  fillOpacity: 0.16,
  baseline: "#e3e8e6",
  label: "#8a938f",
  fontSize: 11,
  valueSize: 16,
  subSize: 12.5,
  valueColor: "#1f2623",
  subColor: "#5b6561",
  dashSigned: "7 5",
  dashProposed: "0.5 5",
  /** Proposals are the least certain money, so their line sits back a little. */
  proposedOpacity: 0.7,
} as const;

export function chartGeometry(
  chart: RevenueChart,
  ahead: ChartAhead | null = null,
  size: { width: number; height: number } = CHART_SIZE,
): ChartGeometry {
  const { width, height } = size;
  // Top padding holds the highest label; there is no y-axis, every figure is labelled.
  const pad = { top: 44, right: 8, bottom: 24, left: 6 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseY = pad.top + plotH;
  const xEnd = pad.left + plotW;

  const n = chart.months.length;
  const totals: number[] = [];
  let running = 0;
  for (const v of chart.months) {
    running += Number.isFinite(v) ? Math.max(0, v) : 0;
    totals.push(running);
  }
  const received = toK(running);
  const signedAdd = toK(ahead?.contracted ?? 0);
  const proposedAdd = toK(ahead?.proposed ?? 0);
  const signed = received + signedAdd;
  const proposed = signed + proposedAdd;
  const hasAhead = signedAdd > 0 || proposedAdd > 0;

  // With work ahead, time takes the left half and stops at the as-of month.
  const split = hasAhead ? (width < 380 ? 0.46 : 0.52) : 1;
  const timeW = plotW * split;
  const yMax = Math.max(running, proposed, 1);
  const x = (i: number) => pad.left + (timeW * i) / n;
  const y = (v: number) => pad.top + plotH * (1 - v / yMax);

  // Point 0 is January 1 at $0; point i is the end of month i.
  const pts = [{ x: x(0), y: y(0) }, ...totals.map((v, i) => ({ x: x(i + 1), y: y(v) }))];
  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join(" ");
  const last = pts[pts.length - 1]!;
  const areaPath = `${linePath} L${f(last.x)} ${f(baseY)} L${f(pts[0]!.x)} ${f(baseY)} Z`;

  // Each line rises on an S-curve, then holds flat: an amount, not a schedule.
  const fan = (to: number, reach: number) => {
    const xr = last.x + plotW * reach;
    const yr = y(to);
    const k = (xr - last.x) / 2;
    return `M${f(last.x)} ${f(last.y)} C${f(last.x + k)} ${f(last.y)} ${f(xr - k)} ${f(yr)} ${f(xr)} ${f(yr)} L${f(xEnd)} ${f(yr)}`;
  };
  const signedPath = signedAdd > 0 ? fan(signed, 0.18) : null;
  const proposedPath = proposedAdd > 0 ? fan(proposed, 0.27) : null;

  // Labels sit above their line. When two tails are close, the upper label moves up to clear.
  const label = (kind: ChartLabel["kind"], lx: number, anchorY: number, value: number, sub: string): ChartLabel => ({
    kind,
    x: f(lx),
    valueY: f(anchorY - 24),
    subY: f(anchorY - 9),
    value: formatShortUsd(value),
    sub,
  });
  const labels: ChartLabel[] = [label("received", hasAhead ? last.x - 8 : xEnd, last.y - (hasAhead ? 4 : 8), received, "received")];
  const signedY = y(signed);
  const proposedY = proposedPath ? Math.max(36, signedPath ? Math.min(y(proposed), signedY - 40) : y(proposed)) : 0;
  // If the tails are too close to stack both labels above, signed's label drops below its line.
  const signedBelow = Boolean(proposedPath && signedPath && signedY - proposedY < 40);
  if (signedPath) labels.push(label("signed", xEnd, signedBelow ? signedY + 34 : signedY, signed, `+${formatShortUsd(signedAdd)} signed`));
  if (proposedPath) labels.push(label("proposed", xEnd, proposedY, proposed, `+${formatShortUsd(proposedAdd)} proposed`));

  const monthTick: ChartTick = hasAhead
    ? { x: f(last.x), label: MONTH_SHORT[n - 1]!, anchor: "middle" }
    : { x: f(xEnd), label: MONTH_SHORT[n - 1]!, anchor: "end" };
  const ticks: ChartTick[] = n === 1 ? [monthTick] : [{ x: f(pad.left), label: MONTH_SHORT[0]!, anchor: "start" }, monthTick];

  return { width, height, baseY: f(baseY), linePath, areaPath, end: { x: f(last.x), y: f(last.y) }, signedPath, proposedPath, labels, ticks };
}

/** The metric card's background. The end dot's ring matches it so the dot reads as cut out of the line. */
export const CHART_SURFACE = "#ffffff";

/** One line under the chart for every renderer. */
export const CHART_FOOTNOTE = "Signed and proposed work is shown without dates.";

/**
 * The chart's marks as an SVG string, with no text: the email image draws its labels with the
 * brand font through the image renderer. Colours are explicit because mail images can't read
 * CSS variables.
 */
export function chartMarksSvg(chart: RevenueChart, color: string, scale = 1, ahead: ChartAhead | null = null): string {
  const g = chartGeometry(chart, ahead);
  const s = CHART_STYLE;
  const id = "rv";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width * scale}" height="${g.height * scale}" viewBox="0 0 ${g.width} ${g.height}">`,
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${color}" stop-opacity="${s.fillOpacity}"/>`,
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/>`,
    `</linearGradient></defs>`,
    `<line x1="0" y1="${g.baseY}" x2="${g.width}" y2="${g.baseY}" stroke="${s.baseline}" stroke-width="1"/>`,
    g.proposedPath
      ? `<path d="${g.proposedPath}" fill="none" stroke="${color}" stroke-opacity="${s.proposedOpacity}" stroke-width="${s.stroke}" stroke-dasharray="${s.dashProposed}" stroke-linecap="round"/>`
      : "",
    g.signedPath ? `<path d="${g.signedPath}" fill="none" stroke="${color}" stroke-width="${s.stroke}" stroke-dasharray="${s.dashSigned}"/>` : "",
    `<path d="${g.areaPath}" fill="url(#${id})"/>`,
    `<path d="${g.linePath}" fill="none" stroke="${color}" stroke-width="${s.stroke}" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="${g.end.x}" cy="${g.end.y}" r="${s.dot}" fill="${color}" stroke="${CHART_SURFACE}" stroke-width="${s.dotRing}"/>`,
    `</svg>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Transport for the email image URL

/** "2026" + "120000,0,45000" → chart; rejects anything malformed. */
export function decodeChart(year: string, months: string): RevenueChart | null {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  const parts = months.split(",");
  if (parts.length < 1 || parts.length > 12) return null;
  const values = parts.map(Number);
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1e11)) return null;
  return { year: y, months: values };
}

export function encodeChartMonths(chart: RevenueChart): string {
  return chart.months.map((v) => String(Math.round(Math.max(0, v)))).join(",");
}
