import type { NextRequest } from "next/server";
import { decodeChart, type ChartAhead } from "@/lib/content/revenue-chart";
import { revenueChartImage } from "@/server/charts/revenue-png";
import { verifyToken } from "@/server/tokens";

const HEX = /^#[0-9a-fA-F]{6}$/;

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

  return revenueChartImage(chart, color, ahead, { "Cache-Control": "public, max-age=31536000, immutable" });
}
