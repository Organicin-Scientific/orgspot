import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { CHART_STYLE, CHART_SURFACE, chartGeometry, chartMarksSvg, decodeChart } from "@/lib/content/revenue-chart";
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
  const fields = verifyToken("chart", token, 3);
  if (!fields) return notFound();
  const [year, months, color] = fields;
  const chart = decodeChart(year, months);
  if (!chart || !HEX.test(color)) return notFound();

  const g = chartGeometry(chart);
  const svg = chartMarksSvg(chart, color, SCALE);
  const label = { position: "absolute" as const, fontSize: CHART_STYLE.fontSize * SCALE, color: CHART_STYLE.label, fontFamily: "Nunito Sans" };

  return new ImageResponse(
    (
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", backgroundColor: CHART_SURFACE }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          width={g.width * SCALE}
          height={g.height * SCALE}
          alt=""
          style={{ position: "absolute", left: 0, top: 0 }}
        />
        <div style={{ ...label, left: 2 * SCALE, top: g.yLabel.y * SCALE }}>{g.yLabel.text}</div>
        {g.ticks.map((t) => (
          <div
            key={t.anchor}
            style={{
              ...label,
              top: (g.baseY + 2) * SCALE,
              ...(t.anchor === "start" ? { left: t.x * SCALE } : { right: (g.width - t.x) * SCALE }),
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
