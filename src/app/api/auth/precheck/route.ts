import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkLoginToken, discardUnauthorizedUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { assertSameOrigin, jsonError, readJson } from "@/server/http/handler";
import { forbidden, unauthorized } from "@/server/http/errors";
import { log } from "@/server/logger";
import { clientIp, enforceRateLimit } from "@/server/ratelimit";

/**
 * Called after the first (Google) factor succeeds. Confirms the account is allowlisted
 * before the user is offered MFA enrolment, and removes Auth records created by anyone else.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await enforceRateLimit("login", clientIp(req));
    const { idToken } = await readJson(req, z.object({ idToken: z.string().min(20).max(5000) }), 10_000);
    const check = await checkLoginToken(idToken);
    if (!check.ok) {
      log.warn("auth.precheck.denied", { reason: check.reason });
      if (check.reason === "not_allowed" || check.reason === "provider") {
        await discardUnauthorizedUser(idToken);
        throw forbidden("This Google account is not authorised to use this application.");
      }
      if (check.reason === "unverified_email") throw forbidden("Your email address must be verified.");
      throw unauthorized("Sign-in expired. Please try again.");
    }
    return NextResponse.json({ ok: true, mfaRequired: env().AUTH_REQUIRE_MFA, mfaSatisfied: check.mfaSatisfied });
  } catch (err) {
    return jsonError(err);
  }
}
