import { decodeChart, type ChartAhead } from "@/lib/content/revenue-chart";
import { revenueChartImage } from "@/server/charts/revenue-png";
import { getSettings } from "@/server/db/settings";
import { badRequest } from "@/server/http/errors";
import { withAdmin } from "@/server/http/handler";

/**
 * The editor's Revenue YTD chart: the same PNG the email carries, drawn from the editor's
 * current figures. Signed-in admins only, so it needs no token.
 */
export const GET = withAdmin(async ({ req }) => {
  const q = req.nextUrl.searchParams;
  const chart = decodeChart(q.get("y") ?? "", q.get("m") ?? "");
  if (!chart) throw badRequest("Invalid chart");
  let ahead: ChartAhead | null = null;
  if (q.has("c") && q.has("p")) {
    const c = Number(q.get("c"));
    const p = Number(q.get("p"));
    if (![c, p].every((v) => Number.isFinite(v) && v >= 0 && v <= 1e11)) throw badRequest("Invalid chart");
    ahead = { contracted: c, proposed: p };
  }
  const settings = await getSettings();
  return revenueChartImage(chart, settings.branding.primaryColor, ahead);
});
