import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/server/auth/admins";
import { CSRF_COOKIE, SESSION_COOKIE, createSession, csrfCookieOptions, sessionCookieOptions } from "@/server/auth/session";
import { env } from "@/server/env";
import { adminAuth } from "@/server/firebase-admin";
import { assertSameOrigin, jsonError, readJson } from "@/server/http/handler";
import { forbidden, notFound } from "@/server/http/errors";

/**
 * Emulator-only sign-in used by local development and end-to-end tests. It is unreachable
 * unless the Auth emulator is configured, and environment validation forbids emulator hosts
 * in production.
 */
export async function POST(req: NextRequest) {
  try {
    const e = env();
    if (!e.FIREBASE_AUTH_EMULATOR_HOST || e.isProduction || e.AUTH_REQUIRE_MFA) throw notFound();
    assertSameOrigin(req);
    const { email } = await readJson(req, z.object({ email: z.email() }));
    if (!(await getAdmin(email, { fresh: true }))) throw forbidden("Not an allowlisted administrator");
    let uid: string;
    try {
      uid = (await adminAuth().getUserByEmail(email)).uid;
    } catch {
      uid = (await adminAuth().createUser({ email, emailVerified: true })).uid;
    }
    const customToken = await adminAuth().createCustomToken(uid);
    const r = await fetch(
      `http://${e.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) },
    );
    const body = (await r.json()) as { idToken?: string };
    if (!body.idToken) throw forbidden("Emulator sign-in failed");
    const { cookie, csrf } = await createSession(body.idToken);
    const maxAge = e.SESSION_MAX_AGE_HOURS * 3600;
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, cookie, sessionCookieOptions(maxAge));
    res.cookies.set(CSRF_COOKIE, csrf, csrfCookieOptions(maxAge));
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
