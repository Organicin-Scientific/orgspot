"use client";

import { useId, useMemo, useState } from "react";
import { LineChart } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CHART_STYLE,
  CHART_SURFACE,
  chartGeometry,
  chartTotal,
  formatShortUsd,
  MONTH_NAMES,
  MONTH_SHORT,
  type RevenueChart,
} from "@/lib/content/revenue-chart";
import { cn } from "@/lib/utils";

/**
 * The Revenue YTD chart in the editor, drawn from the same geometry as the email image and
 * the PDF. Brand line, soft fill, one end dot, first and last month, one scale label. No grid, no legend.
 */
export function RevenueChartGraphic({ chart, className }: { chart: RevenueChart; className?: string }) {
  const g = chartGeometry(chart);
  const gradientId = useId().replace(/:/g, "");
  return (
    <svg
      viewBox={`0 0 ${g.width} ${g.height}`}
      className={cn("block h-auto w-full max-w-[232px]", className)}
      role="img"
      aria-label={`Cumulative cash received, January through ${MONTH_NAMES[chart.months.length - 1]} ${chart.year}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--doc-brand)" stopOpacity={CHART_STYLE.fillOpacity} />
          <stop offset="1" stopColor="var(--doc-brand)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} y1={g.baseY} x2={g.width} y2={g.baseY} stroke={CHART_STYLE.baseline} strokeWidth={1} />
      <path d={g.areaPath} fill={`url(#${gradientId})`} />
      <path d={g.linePath} fill="none" stroke="var(--doc-brand)" strokeWidth={CHART_STYLE.stroke} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={g.end.x} cy={g.end.y} r={CHART_STYLE.dot} fill="var(--doc-brand)" stroke={CHART_SURFACE} strokeWidth={CHART_STYLE.dotRing} />
      <text x={2} y={g.yLabel.y + 8} fontSize={CHART_STYLE.fontSize} fill={CHART_STYLE.label}>
        {g.yLabel.text}
      </text>
      {g.ticks.map((t) => (
        <text key={t.anchor} x={t.x} y={g.baseY + 12} fontSize={CHART_STYLE.fontSize} textAnchor={t.anchor} fill={CHART_STYLE.label}>
          {t.label}
        </text>
      ))}
    </svg>
  );
}

/** Whole dollars from a typed figure: "$12,500" → 12500. Blank or junk counts as 0. */
function parseDollars(text: string): number {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Monthly entry for the Revenue YTD chart: the cash customers paid in each month, from
 * Mercury, January through the update's as-of month. The chart plots the running total.
 */
export function MonthlyFiguresPopover({
  chart,
  disabled,
  onSave,
  onClear,
}: {
  chart: RevenueChart | undefined;
  disabled: boolean;
  onSave: (chart: RevenueChart) => void;
  onClear: () => void;
}) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(chart?.year ?? now.getFullYear());
  const [through, setThrough] = useState(chart?.months.length ?? Math.max(1, now.getMonth()));
  const [values, setValues] = useState<string[]>(() =>
    MONTH_SHORT.map((_, i) => (chart && i < chart.months.length ? String(chart.months[i]) : "")),
  );

  const draft: RevenueChart = useMemo(
    () => ({ year, months: values.slice(0, through).map(parseDollars) }),
    [year, values, through],
  );

  const reset = () => {
    setYear(chart?.year ?? now.getFullYear());
    setThrough(chart?.months.length ?? Math.max(1, now.getMonth()));
    setValues(MONTH_SHORT.map((_, i) => (chart && i < chart.months.length ? String(chart.months[i]) : "")));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="pressable mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-xs text-[#5b6561] disabled:hidden [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[#eef1f0]"
        >
          <LineChart className="size-3" /> {chart ? "Edit monthly figures" : "Enter monthly figures"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 font-sans" align="center" onKeyDown={(e) => e.stopPropagation()}>
        <div>
          <p className="text-sm font-semibold">Customer cash received, by month</p>
          <p className="text-xs text-muted-foreground">From Mercury. Leave out investor money, grants, loans, interest, refunds and transfers between accounts.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5">
            Year
            <input
              type="number"
              value={year}
              min={2000}
              max={2100}
              onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
              className="w-16 rounded border border-input bg-transparent px-1.5 py-1 tabular-nums"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Through
            <select
              value={through}
              onChange={(e) => setThrough(Number(e.target.value))}
              className="rounded border border-input bg-transparent px-1.5 py-1"
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MONTH_SHORT.slice(0, through).map((m, i) => (
            <label key={m} className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
              {m}
              <input
                inputMode="decimal"
                placeholder="$0"
                value={values[i]}
                onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                className="w-full rounded border border-input bg-transparent px-1.5 py-1 text-sm text-foreground tabular-nums"
              />
            </label>
          ))}
        </div>
        <div className="rounded-md bg-[#f6f8f7] px-2 pt-2 pb-1">
          <p className="text-center text-lg font-bold tabular-nums text-[var(--doc-brand)]">{formatShortUsd(chartTotal(draft))}</p>
          <RevenueChartGraphic chart={draft} className="mx-auto" />
        </div>
        <div className="flex items-center justify-between">
          {chart ? (
            <button
              type="button"
              className="pressable rounded px-2 py-1 text-xs text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Clear
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="pressable rounded-md bg-[var(--doc-brand)] px-3 py-1.5 text-xs font-semibold text-white"
            onClick={() => {
              onSave(draft);
              setOpen(false);
            }}
          >
            Save figures
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
