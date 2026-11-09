import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  createSession,
  csrfCookieOptions,
  sessionCookieOptions,
} from "@/server/auth/session";
import { env } from "@/server/env";
import { assertSameOrigin, jsonError, readJson } from "@/server/http/handler";
import { clientIp, enforceRateLimit } from "@/server/ratelimit";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await enforceRateLimit("login", clientIp(req));
    const { idToken } = await readJson(req, z.object({ idToken: z.string().min(20).max(5000) }), 10_000);
    const { cookie, csrf, email } = await createSession(idToken);
    const maxAge = env().SESSION_MAX_AGE_HOURS * 3600;
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, cookie, sessionCookieOptions(maxAge));
    res.cookies.set(CSRF_COOKIE, csrf, csrfCookieOptions(maxAge));
    res.headers.set("Cache-Control", "no-store");
    await audit({ actorEmail: email, action: "auth.login", resourceType: "session", summary: "Signed in" });
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
