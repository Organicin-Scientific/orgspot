import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { ingestEvent, normalizeResendEvent } from "@/server/campaigns/events";
import { env } from "@/server/env";
import { log } from "@/server/logger";

const MAX_BODY = 256 * 1024;

/**
 * Resend delivery/engagement webhooks. The raw body is verified with the Svix signature
 * before parsing; the svix-id makes processing idempotent across provider retries.
 */
export async function POST(req: NextRequest) {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };
  let payload: unknown;
  try {
    payload = new Webhook(secret).verify(raw, headers);
  } catch {
    log.warn("webhook.signature_invalid");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const event = normalizeResendEvent(headers["svix-id"], payload);
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  try {
    const result = await ingestEvent(event);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    log.error("webhook.ingest_failed", { err, type: event.type });
    // A 5xx asks Resend to retry later; ingestion is idempotent.
    return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  }
}
