import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { CHART_STYLE, CHART_SURFACE, chartGeometry, chartMarksSvg, type ChartAhead, type RevenueChart } from "@/lib/content/revenue-chart";

/** Rendered at 2x the display size so the chart stays sharp on high-density screens. */
const SCALE = 2;

let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | null = null;
function loadFonts() {
  // src/fonts ships with /api functions through outputFileTracingIncludes (next.config.ts).
  fonts ??= Promise.all(
    ([[400, "nunito-sans-latin-400-normal.woff"], [700, "nunito-sans-latin-700-normal.woff"]] as const).map(async ([weight, file]) => {
      const buf = await readFile(path.join(process.cwd(), "src", "fonts", file));
      return { name: "Nunito Sans", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, weight, style: "normal" as const };
    }),
  );
  return fonts;
}

/**
 * The Revenue YTD chart as a PNG: the one picture of it. The email, the editor and the PDF all
 * show this image, so what the editor shows is exactly what investors get.
 */
export async function revenueChartImage(chart: RevenueChart, color: string, ahead: ChartAhead | null, headers: Record<string, string> = {}) {
  const g = chartGeometry(chart, ahead);
  const svg = chartMarksSvg(chart, color, SCALE, ahead);
  const st = CHART_STYLE;
  const abs = { position: "absolute" as const, display: "flex", fontFamily: "Nunito Sans", lineHeight: 1 };
  // The renderer places text by its top edge; geometry gives baselines. Cap height is ~0.74em.
  const top = (baseline: number, size: number) => (baseline - size * 0.8) * SCALE;

  return new ImageResponse(
    (
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", backgroundColor: CHART_SURFACE }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} width={g.width * SCALE} height={g.height * SCALE} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
        {g.yTicks.map((t) => (
          <div key={t.text} style={{ ...abs, left: 2 * SCALE, top: top(t.y - 4, st.fontSize), fontSize: st.fontSize * SCALE, color: st.label }}>
            {t.text}
          </div>
        ))}
        {g.labels.flatMap((l) => [
          <div key={l.kind + "v"} style={{ ...abs, ...(l.anchor === "end" ? { right: (g.width - l.x) * SCALE } : { left: l.x * SCALE }), top: top(l.valueY, st.valueSize), fontSize: st.valueSize * SCALE, fontWeight: 700, color: st.valueColor }}>
            {l.value}
          </div>,
          <div
            key={l.kind + "n"}
            style={{ ...abs, ...(l.anchor === "end" ? { right: (g.width - l.x) * SCALE } : { left: l.x * SCALE }), top: top(l.nameY, st.nameSize), fontSize: st.nameSize * SCALE, color: st.nameColor }}
          >
            {l.name}
          </div>,
        ])}
        {g.ticks.map((t) => (
          <div
            key={t.label + t.anchor}
            style={{
              ...abs,
              fontSize: st.fontSize * SCALE,
              color: st.label,
              top: (g.baseY + 7) * SCALE,
              ...(t.anchor === "start"
                ? { left: t.x * SCALE }
                : t.anchor === "end"
                  ? { right: (g.width - t.x) * SCALE }
                  : { left: (t.x - 20) * SCALE, width: 40 * SCALE, justifyContent: "center" }),
            }}
          >
            {t.label}
          </div>
        ))}
      </div>
    ),
    {
      width: g.width * SCALE,
      height: g.height * SCALE,
      fonts: await loadFonts(),
      headers,
    },
  );
}

export async function revenueChartPng(chart: RevenueChart, color: string, ahead: ChartAhead | null): Promise<Buffer> {
  const res = await revenueChartImage(chart, color, ahead);
  return Buffer.from(await res.arrayBuffer());
}
