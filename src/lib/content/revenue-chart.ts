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

/** The standing definitions shown under each metric's name, on the strip and on the chart. */
export const METRIC_DEFINITIONS = {
  [REVENUE_YTD_LABEL]: "cash received since Jan 1",
  [CONTRACTED_LABEL]: "signed, not yet collected",
  [PIPELINE_LABEL]: "proposed, not yet signed",
} as const;

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
    signedAdd > 0 ? `Contracted backlog: ${formatShortUsd(signedAdd)}, signed, not yet collected (dashed line).` : "",
    proposedAdd > 0 ? `Pipeline: ${formatShortUsd(proposedAdd)}, proposed, not yet signed (dotted line).` : "",
  ].filter(Boolean);
  return parts.length ? `${base} ${parts.join(" ")} Both continue the line without dates.` : base;
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

/** A direct label: the metric's figure above its name, aligned to x. Definitions sit under the chart. */
export interface ChartLabel {
  kind: "received" | "signed" | "proposed";
  x: number;
  anchor: "end";
  /** Baselines of the two lines. */
  valueY: number;
  nameY: number;
  value: string;
  name: string;
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
  /** Faint gridlines with running-total values: the lines stack, so each height is a sum. */
  yTicks: { y: number; text: string }[];
}

/** Round up to a clean step of a power of ten, close enough that the lines fill the plot. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * pow >= v) return step * pow;
  return 10 * pow;
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
  grid: "#eef1f0",
  label: "#8a938f",
  fontSize: 10,
  valueSize: 14,
  nameSize: 11,
  valueColor: "#1f2623",
  nameColor: "#5b6561",
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
  const pad = { top: 38, right: 8, bottom: 22, left: 6 };
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

  // With work ahead, time takes the left part and stops at the as-of month. Narrow drawings
  // give the right more room so the rising lines clear the labels at the edge.
  const narrow = width < 380;
  const split = hasAhead ? (narrow ? 0.4 : 0.52) : 1;
  const timeW = plotW * split;
  // A clean top value, split into three gridlines: $200K, $400K, $600K.
  const yMax = niceMax(Math.max(running, proposed, 1));
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
  const signedPath = signedAdd > 0 ? fan(signed, narrow ? 0.11 : 0.18) : null;
  const proposedPath = proposedAdd > 0 ? fan(proposed, narrow ? 0.16 : 0.27) : null;

  // Each line is labelled with its own metric's figure and name. Labels sit above their line;
  // when two tails are close, they're kept apart.
  const GAP = 34;
  const label = (kind: ChartLabel["kind"], name: string, lx: number, anchorY: number, value: number): ChartLabel => ({
    kind,
    x: f(lx),
    anchor: "end",
    valueY: f(anchorY - 20),
    nameY: f(anchorY - 7),
    // Backlog and pipeline stack on what's received, so their figures read as additions.
    value: (kind === "received" ? "" : "+") + formatShortUsd(value),
    name,
  });
  // Revenue YTD sits just above where the received line ends.
  const labels: ChartLabel[] = [label("received", REVENUE_YTD_LABEL, hasAhead ? last.x - 8 : xEnd, last.y - (hasAhead ? 4 : 8), received)];
  const signedY = y(signed);
  const proposedY = proposedPath ? Math.max(32, signedPath ? Math.min(y(proposed), signedY - GAP) : y(proposed)) : 0;
  // If the tails are too close to stack both labels above, the backlog label drops below its line.
  const signedBelow = Boolean(proposedPath && signedPath && signedY - proposedY < GAP);
  if (signedPath) labels.push(label("signed", CONTRACTED_LABEL, xEnd, signedBelow ? signedY + 30 : signedY, signedAdd));
  if (proposedPath) labels.push(label("proposed", PIPELINE_LABEL, xEnd, proposedY, proposedAdd));

  const monthTick: ChartTick = hasAhead
    ? { x: f(last.x), label: MONTH_SHORT[n - 1]!, anchor: "middle" }
    : { x: f(xEnd), label: MONTH_SHORT[n - 1]!, anchor: "end" };
  const ticks: ChartTick[] = n === 1 ? [monthTick] : [{ x: f(pad.left), label: MONTH_SHORT[0]!, anchor: "start" }, monthTick];

  const yTicks = [1, 2, 3].map((i) => ({ y: f(y((yMax * i) / 3)), text: formatShortUsd((yMax * i) / 3) }));

  return { width, height, baseY: f(baseY), linePath, areaPath, end: { x: f(last.x), y: f(last.y) }, signedPath, proposedPath, labels, ticks, yTicks };
}

/** The metric card's background. The end dot's ring matches it so the dot reads as cut out of the line. */
export const CHART_SURFACE = "#ffffff";

/**
 * Definitions printed under the chart, one per line drawn, in plain technical English: short,
 * present tense, one fact each. Investors check the figures against these.
 */
export const CHART_DEFINITIONS = {
  [REVENUE_YTD_LABEL]: "cash paid by customers (cash basis).",
  [CONTRACTED_LABEL]: "signed work, not paid yet.",
  [PIPELINE_LABEL]: "proposals, not signed yet.",
} as const;

/** The definition lines for a chart: only the metrics it draws. */
export function chartDefinitions(g: ChartGeometry): { name: string; text: string }[] {
  return g.labels.map((l) => ({ name: l.name, text: CHART_DEFINITIONS[l.name as keyof typeof CHART_DEFINITIONS] }));
}

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
    ...g.yTicks.map((t) => `<line x1="0" y1="${t.y}" x2="${g.width}" y2="${t.y}" stroke="${s.grid}" stroke-width="1"/>`),
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
