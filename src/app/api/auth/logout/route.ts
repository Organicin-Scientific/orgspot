import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/server/audit";
import { CSRF_COOKIE, SESSION_COOKIE, revokeSession, verifySession } from "@/server/auth/session";
import { assertSameOrigin, jsonError } from "@/server/http/handler";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const cookie = req.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(cookie);
    await revokeSession(cookie);
    if (session) await audit({ actorEmail: session.email, action: "auth.logout", resourceType: "session", summary: "Signed out" });
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(CSRF_COOKIE);
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
