import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeRecipient } from "@/server/campaigns/events";
import { log } from "@/server/logger";
import { verifyToken } from "@/server/tokens";

/**
 * RFC 8058 one-click unsubscribe (mailbox providers POST here without cookies), and the
 * confirmation form on /u/[token]. The signed token is the only credential required.
 *
 * There is deliberately no rate limit here. Gmail and Yahoo send one-click requests from
 * shared infrastructure, so an IP-based limit could refuse a legitimate unsubscribe, and
 * a refused unsubscribe is a compliance and spam-complaint risk. Invalid tokens are
 * rejected by the HMAC check before any database work, and the write itself is idempotent.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const fields = verifyToken("unsub", token, 2);
  if (!fields) return NextResponse.json({ error: "invalid_link" }, { status: 404 });
  try {
    await unsubscribeRecipient(fields[0], fields[1]);
  } catch (err) {
    log.error("unsubscribe.failed", { err });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  const fromForm = (req.headers.get("content-type") ?? "").includes("form") && req.nextUrl.searchParams.get("form") === "1";
  if (fromForm) return NextResponse.redirect(new URL(`/u/${token}?done=1`, req.nextUrl.origin), 303);
  return NextResponse.json({ ok: true });
}
