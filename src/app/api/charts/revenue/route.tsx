import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { CHART_STYLE, CHART_SURFACE, chartGeometry, chartMarksSvg, decodeChart, type ChartAhead } from "@/lib/content/revenue-chart";
import { verifyToken } from "@/server/tokens";

/** Rendered at 2x the display size so the chart stays sharp on high-density screens. */
const SCALE = 2;
const HEX = /^#[0-9a-fA-F]{6}$/;

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

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * The Revenue YTD chart as a static PNG for emails. Mail clients fetch it without a session,
 * so the figures travel in a signed token: this route only draws charts the app itself put
 * in a rendered email. The image for a given token never changes, so it caches forever.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("c") ?? "";
  // Five fields carry the trajectory's undated segments; three (older emails) are the plain line.
  const fields = verifyToken("chart", token, 5) ?? verifyToken("chart", token, 3);
  if (!fields) return notFound();
  const [year, months, color, contracted, proposed] = fields;
  const chart = decodeChart(year, months);
  if (!chart || !HEX.test(color)) return notFound();
  let ahead: ChartAhead | null = null;
  if (contracted !== undefined && proposed !== undefined) {
    const c = Number(contracted);
    const p = Number(proposed);
    if (![c, p].every((v) => Number.isFinite(v) && v >= 0 && v <= 1e11)) return notFound();
    ahead = { contracted: c, proposed: p };
  }

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
        {g.labels.flatMap((l) => [
          <div key={l.kind + "v"} style={{ ...abs, ...(l.anchor === "end" ? { right: (g.width - l.x) * SCALE } : { left: l.x * SCALE }), top: top(l.valueY, st.valueSize), fontSize: st.valueSize * SCALE, fontWeight: 700, color: st.valueColor }}>
            {l.value}
          </div>,
          <div key={l.kind + "n"} style={{ ...abs, ...(l.anchor === "end" ? { right: (g.width - l.x) * SCALE } : { left: l.x * SCALE }), top: top(l.nameY, st.nameSize), fontSize: st.nameSize * SCALE, fontWeight: 700, color: st.valueColor }}>
            {l.name}
          </div>,
          <div key={l.kind + "s"} style={{ ...abs, ...(l.anchor === "end" ? { right: (g.width - l.x) * SCALE } : { left: l.x * SCALE }), top: top(l.subY, st.subSize), fontSize: st.subSize * SCALE, color: st.subColor }}>
            {l.sub}
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
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
