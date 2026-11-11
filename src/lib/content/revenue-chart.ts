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

export const REVENUE_YTD_LABEL = "Revenue YTD";
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

/** Alt text for the static image: states the total and the period it covers. */
export function chartAltText(chart: RevenueChart): string {
  const last = MONTH_NAMES[chart.months.length - 1];
  const period = chart.months.length === 1 ? `January ${chart.year}` : `January through ${last} ${chart.year}`;
  return `Revenue YTD: ${formatShortUsd(chartTotal(chart))} cash received from customers, ${period}.`;
}

// ---------------------------------------------------------------------------
// Geometry

/** Drawing size in CSS pixels. The email image is rendered at 2x for sharp screens. */
export const CHART_SIZE = { width: 232, height: 88 } as const;

export interface ChartTick {
  x: number;
  label: string;
  /** "start" hangs the label right of x, "end" left of it, so neither runs off the edge. */
  anchor: "start" | "end";
}

export interface ChartGeometry {
  width: number;
  height: number;
  /** Bottom of the plot, where the baseline sits. */
  baseY: number;
  linePath: string;
  areaPath: string;
  end: { x: number; y: number };
  /** Two month labels: January at the left edge, the as-of month at the right. */
  ticks: ChartTick[];
  /** Muted scale label at the top-left, the only y-axis text. */
  yLabel: { y: number; text: string };
}

/** Round up to a clean step of a power of ten, close enough that the line fills the plot. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * pow >= v) return step * pow;
  return 10 * pow;
}

const f = (n: number) => Number(n.toFixed(2));

/** Line weight, end-dot radius and fill strength, shared by every renderer. */
export const CHART_STYLE = {
  stroke: 2,
  dot: 3.5,
  dotRing: 2,
  fillOpacity: 0.16,
  baseline: "#e3e8e6",
  label: "#8a938f",
  fontSize: 9.5,
} as const;

export function chartGeometry(chart: RevenueChart, size: { width: number; height: number } = CHART_SIZE): ChartGeometry {
  const { width, height } = size;
  // Right padding leaves room for the end dot and its ring.
  const pad = { top: 14, right: 6, bottom: 16, left: 2 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseY = pad.top + plotH;

  // The x-axis runs January 1 to the end of the as-of month, so the line always spans the plot.
  const n = chart.months.length;
  const totals: number[] = [];
  let running = 0;
  for (const v of chart.months) {
    running += Number.isFinite(v) ? Math.max(0, v) : 0;
    totals.push(running);
  }
  const yMax = niceMax(running);
  const x = (i: number) => pad.left + (plotW * i) / n;
  const y = (v: number) => pad.top + plotH * (1 - v / yMax);

  // Point 0 is January 1 at $0; point i is the end of month i.
  const pts = [{ x: x(0), y: y(0) }, ...totals.map((v, i) => ({ x: x(i + 1), y: y(v) }))];
  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join(" ");
  const last = pts[pts.length - 1];
  const areaPath = `${linePath} L${f(last.x)} ${f(baseY)} L${f(pts[0].x)} ${f(baseY)} Z`;

  const right = { x: f(width - 1), label: MONTH_SHORT[n - 1], anchor: "end" as const };
  const ticks: ChartTick[] = n === 1 ? [right] : [{ x: f(pad.left), label: MONTH_SHORT[0], anchor: "start" }, right];

  return {
    width,
    height,
    baseY: f(baseY),
    linePath,
    areaPath,
    end: { x: f(last.x), y: f(last.y) },
    ticks,
    yLabel: { y: 2, text: formatShortUsd(yMax) },
  };
}

/** The metric card's tint. The end dot's ring matches it so the dot reads as cut out of the line. */
export const CHART_SURFACE = "#f6f8f7";

/**
 * The chart's marks as an SVG string, with no text: the email image draws its labels with the
 * brand font through the image renderer, and the editor uses its own JSX. Colours are
 * explicit because mail images can't read CSS variables.
 */
export function chartMarksSvg(chart: RevenueChart, color: string, scale = 1): string {
  const g = chartGeometry(chart);
  const s = CHART_STYLE;
  const w = g.width * scale;
  const h = g.height * scale;
  const id = "rv";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${g.width} ${g.height}">`,
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${color}" stop-opacity="${s.fillOpacity}"/>`,
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/>`,
    `</linearGradient></defs>`,
    `<line x1="0" y1="${g.baseY}" x2="${g.width}" y2="${g.baseY}" stroke="${s.baseline}" stroke-width="1"/>`,
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
