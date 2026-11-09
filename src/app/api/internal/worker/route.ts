import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { parseHop, triggerWorkerContinuation, WORKER_HOP_HEADER } from "@/server/campaigns/continuation";
import { drainSendQueue } from "@/server/campaigns/worker";
import { env } from "@/server/env";
import { ok, withAdmin } from "@/server/http/handler";
import { log } from "@/server/logger";

export const maxDuration = 60;

/** Leaves headroom inside maxDuration for the continuation hand-off. */
const WORKER_BUDGET_MS = 50_000;

function cronAuthorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env().CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleWorker(hop: number) {
  try {
    const result = await drainSendQueue(WORKER_BUDGET_MS);
    if (result.remaining) after(() => triggerWorkerContinuation(hop));
    return result;
  } catch (err) {
    log.error("worker.run_failed", { err });
    throw err;
  }
}

/**
 * Scheduled runs (Vercel Cron, the GitHub Actions send-worker workflow) and chained
 * continuations land here. They recover interrupted sends, pick up due retries and
 * drain any backlog.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await handleWorker(parseHop(req.headers.get(WORKER_HOP_HEADER)));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}

/** Admins can resume a large send when the queue still has work after the post-approval run. */
export const POST = withAdmin(async () => ok(await handleWorker(0)), { rateLimit: "campaign" });
