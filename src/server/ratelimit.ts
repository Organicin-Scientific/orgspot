import "server-only";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { tooManyRequests } from "./http/errors";
import { log } from "./logger";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  login: { limit: 20, windowSeconds: 600 },
  read: { limit: 600, windowSeconds: 60 },
  write: { limit: 120, windowSeconds: 60 },
  import: { limit: 20, windowSeconds: 600 },
  upload: { limit: 60, windowSeconds: 600 },
  testSend: { limit: 10, windowSeconds: 600 },
  campaign: { limit: 20, windowSeconds: 600 },
  export: { limit: 10, windowSeconds: 600 },
  aiDraft: { limit: 30, windowSeconds: 600 },
  publicLink: { limit: 30, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Fixed-window counter in Firestore. Works across serverless instances without extra
 * infrastructure; documents carry `expiresAt` for a Firestore TTL policy.
 */
export async function enforceRateLimit(name: RateLimitName, subject: string): Promise<void> {
  const rule = RATE_LIMITS[name];
  const windowStart = Math.floor(Date.now() / 1000 / rule.windowSeconds) * rule.windowSeconds;
  const key = createHash("sha256").update(`${name}:${subject}`).digest("hex").slice(0, 32);
  const ref = db().collection("rateLimits").doc(`${key}_${windowStart}`);
  let count = 0;
  try {
    count = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = ((snap.data()?.count as number) ?? 0) + 1;
      tx.set(ref, {
        count: next,
        name,
        expiresAt: Timestamp.fromMillis((windowStart + rule.windowSeconds * 2) * 1000),
      });
      return next;
    });
  } catch (err) {
    // Fail open on limiter infrastructure errors; authentication still applies.
    log.warn("ratelimit.error", { name, err });
    return;
  }
  if (count > rule.limit) throw tooManyRequests();
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}
