import "server-only";
import { env } from "../env";
import { log } from "../logger";

/** Header carrying how many times a send has been handed to a fresh invocation. */
export const WORKER_HOP_HEADER = "x-worker-hop";

/**
 * Upper bound on chained invocations for one backlog. Each hop sends for about 50 seconds,
 * so 60 hops is roughly an hour of continuous sending before the scheduled worker takes over.
 */
const MAX_HOPS = 60;

/** How long to wait for the next invocation to start before letting this one finish. */
const HANDOFF_WAIT_MS = 2_500;

export function parseHop(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_HOPS ? n : 0;
}

/**
 * Start a fresh worker invocation when a send still has queued recipients after this
 * function's time budget ran out. Without this, anything beyond ~100 recipients waits for
 * the next scheduled worker run or a manual "Resume" click.
 *
 * The request is only awaited long enough to be accepted. Aborting the wait does not stop
 * the receiving invocation, which drains the queue and chains again if needed.
 */
export async function triggerWorkerContinuation(hop: number): Promise<void> {
  if (hop >= MAX_HOPS) {
    log.warn("worker.continuation_limit", { hop });
    return;
  }
  const e = env();
  try {
    await fetch(new URL("/api/internal/worker", e.APP_URL), {
      method: "GET",
      headers: { authorization: `Bearer ${e.CRON_SECRET}`, [WORKER_HOP_HEADER]: String(hop + 1) },
      cache: "no-store",
      signal: AbortSignal.timeout(HANDOFF_WAIT_MS),
    });
  } catch (err) {
    // A timeout is the expected outcome: the next invocation is running and we stop waiting.
    if ((err as Error)?.name !== "TimeoutError") log.warn("worker.continuation_failed", { hop, err });
  }
}
