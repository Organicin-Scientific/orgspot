import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { drainSendQueue } from "@/server/campaigns/worker";
import { env } from "@/server/env";
import { ok, withAdmin } from "@/server/http/handler";
import { log } from "@/server/logger";

export const maxDuration = 60;

const WORKER_BUDGET_MS = 55_000;

function cronAuthorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env().CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleWorker() {
  try {
    return await drainSendQueue(WORKER_BUDGET_MS);
  } catch (err) {
    log.error("worker.run_failed", { err });
    throw err;
  }
}

/** Vercel Cron (once daily) recovers interrupted sends and drains any backlog. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await handleWorker();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}

/** Admins can resume a large send when the queue still has work after the post-approval run. */
export const POST = withAdmin(async () => ok(await handleWorker()), { rateLimit: "campaign" });
