"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROMPT_OPEN } from "@/lib/content/template";
import {
  CHART_SIZE,
  chartAltText,
  chartPreviewPath,
  type ChartAhead,
  MONTH_NAMES,
  MONTH_SHORT,
  type RevenueChart,
} from "@/lib/content/revenue-chart";

/**
 * The Revenue YTD chart in the editor: the same PNG the email and the PDF carry, so the editor
 * shows exactly what investors get. Figures settle for a moment before the image reloads, so
 * typing a value doesn't fetch a picture per keystroke.
 */
export function RevenueChartImage({ chart, ahead = null }: { chart: RevenueChart; ahead?: ChartAhead | null }) {
  const src = chartPreviewPath(chart, ahead);
  const [shown, setShown] = useState(src);
  useEffect(() => {
    if (src === shown) return;
    const t = setTimeout(() => setShown(src), 400);
    return () => clearTimeout(t);
  }, [src, shown]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      width={CHART_SIZE.width}
      height={CHART_SIZE.height}
      alt={chartAltText(chart, ahead)}
      draggable={false}
      className="block h-auto w-full select-none"
    />
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
  extras = [],
}: {
  chart: RevenueChart | undefined;
  disabled: boolean;
  onSave: (chart: RevenueChart, extraValues: string[]) => void;
  onClear: () => void;
  /** Other figures the chart draws (backlog, pipeline), edited here once the chart replaces their rows. */
  extras?: { label: string; value: string }[];
}) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(chart?.year ?? now.getFullYear());
  const [through, setThrough] = useState(chart?.months.length ?? Math.max(1, now.getMonth()));
  const [values, setValues] = useState<string[]>(() =>
    MONTH_SHORT.map((_, i) => (chart && i < chart.months.length ? String(chart.months[i]) : "")),
  );

  const typed = (v: string) => (v.includes(PROMPT_OPEN) ? "" : v);
  const [extraValues, setExtraValues] = useState<string[]>(() => extras.map((e) => typed(e.value)));
  const draft: RevenueChart = useMemo(
    () => ({ year, months: values.slice(0, through).map(parseDollars) }),
    [year, values, through],
  );

  const reset = () => {
    setYear(chart?.year ?? now.getFullYear());
    setThrough(chart?.months.length ?? Math.max(1, now.getMonth()));
    setValues(MONTH_SHORT.map((_, i) => (chart && i < chart.months.length ? String(chart.months[i]) : "")));
    setExtraValues(extras.map((e) => typed(e.value)));
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
          <LineChart className="size-3" /> {extras.length ? "Edit figures" : chart ? "Edit monthly figures" : "Enter monthly figures"}
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
        {extras.length ? (
          <div className="grid gap-1.5 border-t border-border pt-2">
            {extras.map((e, i) => (
              <label key={e.label} className="flex items-center justify-between gap-2 text-xs">
                {e.label}
                <input
                  value={extraValues[i]}
                  placeholder="$0"
                  maxLength={40}
                  onChange={(ev) => setExtraValues((v) => v.map((x, j) => (j === i ? ev.target.value : x)))}
                  className="w-28 rounded border border-input bg-transparent px-1.5 py-1 text-right text-sm text-foreground tabular-nums"
                />
              </label>
            ))}
          </div>
        ) : null}
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
              onSave(draft, extraValues);
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
