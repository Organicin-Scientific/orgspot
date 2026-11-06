import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Compact HMAC-signed tokens for unauthenticated links in emails (unsubscribe, PDF download).
 * Tokens are deterministic for a given payload so that a retried send produces byte-identical
 * email content, which keeps provider idempotency keys valid.
 */

type Purpose = "unsub" | "file" | "asset";

function sign(data: string): string {
  return createHmac("sha256", env().TOKEN_SIGNING_SECRET).update(data).digest("base64url").slice(0, 32);
}

function encode(parts: string[]): string {
  return Buffer.from(parts.join("|"), "utf8").toString("base64url");
}

export function createToken(purpose: Purpose, fields: string[], expiresAtMs?: number): string {
  for (const f of fields) {
    if (f.includes("|")) throw new Error("Token fields may not contain '|'");
  }
  const parts = [purpose, ...fields, expiresAtMs ? String(Math.floor(expiresAtMs / 1000)) : "0"];
  const body = encode(parts);
  return `${body}.${sign(body)}`;
}

export function verifyToken(purpose: Purpose, token: string, fieldCount: number): string[] | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parts: string[];
  try {
    parts = Buffer.from(body, "base64url").toString("utf8").split("|");
  } catch {
    return null;
  }
  if (parts.length !== fieldCount + 2 || parts[0] !== purpose) return null;
  const exp = Number(parts[parts.length - 1]);
  if (exp > 0 && Date.now() / 1000 > exp) return null;
  return parts.slice(1, -1);
}

export function unsubscribeToken(campaignId: string, recipientId: string) {
  return createToken("unsub", [campaignId, recipientId]);
}

/** Short-lived access to an unpublished image for the sandboxed preview iframe. */
export function assetPreviewToken(assetId: string) {
  const hour = 60 * 60_000;
  // Rounded expiry keeps the token stable for a while, so preview HTML stays cacheable client-side.
  return createToken("asset", [assetId], Math.ceil((Date.now() + hour) / hour) * hour);
}

/** `fileKey` is "update" for the campaign PDF, or an attachment asset id. */
export function fileToken(campaignId: string, recipientId: string, fileKey: string, expiresAtMs: number) {
  return createToken("file", [campaignId, recipientId, fileKey], expiresAtMs);
}
