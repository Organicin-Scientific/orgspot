import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runWorker } from "@/server/campaigns/worker";
import { env } from "@/server/env";
import { log } from "@/server/logger";

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env().CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Invoked by Vercel Cron every minute to drain the send queue and recover interrupted jobs. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runWorker(50_000);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("worker.cron_failed", { err });
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}
