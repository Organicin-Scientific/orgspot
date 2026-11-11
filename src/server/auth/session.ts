import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { normalizeEmail } from "@/lib/email-address";
import { env } from "../env";
import { adminAuth } from "../firebase-admin";
import { forbidden, unauthorized } from "../http/errors";
import { log } from "../logger";
import { bindAdminUid, getAdmin } from "./admins";

export const SESSION_COOKIE = "__session";
export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

const MAX_AUTH_AGE_SECONDS = 5 * 60;

export interface AdminSession {
  uid: string;
  email: string;
}

export type LoginCheck =
  | { ok: true; decoded: DecodedIdToken; email: string; mfaSatisfied: boolean }
  | { ok: false; reason: "invalid_token" | "stale_login" | "unverified_email" | "not_allowed" | "provider" };

/**
 * Validate a freshly minted Firebase ID token for login. Used both for the pre-check
 * (before MFA enrolment) and for minting the session cookie.
 */
export async function checkLoginToken(idToken: string): Promise<LoginCheck> {
  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth().verifyIdToken(idToken, true);
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - decoded.auth_time > MAX_AUTH_AGE_SECONDS) return { ok: false, reason: "stale_login" };
  if (!decoded.email || decoded.email_verified !== true) return { ok: false, reason: "unverified_email" };

  const provider = decoded.firebase?.sign_in_provider;
  const e = env();
  const providerOk = provider === "google.com" || (e.usesEmulators && !e.isProduction && provider === "custom");
  if (!providerOk) return { ok: false, reason: "provider" };

  const email = normalizeEmail(decoded.email);
  const admin = await getAdmin(email, { fresh: true });
  if (!admin) return { ok: false, reason: "not_allowed" };

  const mfaSatisfied = Boolean(decoded.firebase?.sign_in_second_factor);
  return { ok: true, decoded, email, mfaSatisfied };
}

/** Remove Firebase Auth records created by people who are not on the allowlist. */
export async function discardUnauthorizedUser(idToken: string) {
  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const email = decoded.email ? normalizeEmail(decoded.email) : null;
    if (email && (await getAdmin(email, { fresh: true }))) return;
    await adminAuth().deleteUser(decoded.uid);
  } catch {
    // Token invalid or user already gone: nothing to clean up.
  }
}

export async function createSession(idToken: string): Promise<{ cookie: string; csrf: string; email: string }> {
  const check = await checkLoginToken(idToken);
  if (!check.ok) {
    log.warn("auth.session.denied", { reason: check.reason });
    throw check.reason === "not_allowed" ? forbidden("This account is not authorised.") : unauthorized("Sign-in failed.");
  }
  if (env().AUTH_REQUIRE_MFA && !check.mfaSatisfied) {
    throw forbidden("Two-factor authentication is required.");
  }
  const expiresIn = env().SESSION_MAX_AGE_HOURS * 60 * 60 * 1000;
  // Independent calls: mint the cookie and record the login at the same time.
  const [cookie] = await Promise.all([
    adminAuth().createSessionCookie(idToken, { expiresIn }),
    bindAdminUid(check.email, check.decoded.uid),
  ]);
  return { cookie, csrf: randomBytes(24).toString("base64url"), email: check.email };
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function csrfCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * A full session check costs two network calls (Firebase Auth for revocation, Firestore for
 * the allowlist). Successful checks are reused for SESSION_CHECK_CACHE_MS per warm instance,
 * so a revoked session or a removed admin keeps access for at most that long. Failed checks
 * are never cached, and signing out clears the entry immediately on this instance.
 */
export const SESSION_CHECK_CACHE_MS = 60_000;
const SESSION_CACHE_MAX_ENTRIES = 500;
const sessionCache = new Map<string, { at: number; session: AdminSession }>();

function sessionCacheKey(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("base64url");
}

function cacheSession(key: string, session: AdminSession) {
  const now = Date.now();
  if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) {
    for (const [k, v] of sessionCache) if (now - v.at >= SESSION_CHECK_CACHE_MS) sessionCache.delete(k);
    if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) sessionCache.clear();
  }
  sessionCache.set(key, { at: now, session });
}

export function clearSessionCache() {
  sessionCache.clear();
}

/** Verify the session cookie (including revocation) and the live allowlist entry. */
export async function verifySession(cookieValue: string | undefined): Promise<AdminSession | null> {
  if (!cookieValue) return null;
  const key = sessionCacheKey(cookieValue);
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.at < SESSION_CHECK_CACHE_MS) return hit.session;
  if (hit) sessionCache.delete(key);

  const session = await verifySessionUncached(cookieValue);
  if (session) cacheSession(key, session);
  return session;
}

async function verifySessionUncached(cookieValue: string): Promise<AdminSession | null> {
  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth().verifySessionCookie(cookieValue, true);
  } catch {
    return null;
  }
  if (!decoded.email || decoded.email_verified !== true) return null;
  const email = normalizeEmail(decoded.email);
  const admin = await getAdmin(email, { fresh: true });
  if (!admin) return null;
  return { uid: decoded.uid, email };
}

export async function getSession(): Promise<AdminSession | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** For server components: returns the admin or redirects to the login page. */
export async function requireAdminPage(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function revokeSession(cookieValue: string | undefined) {
  if (!cookieValue) return;
  sessionCache.delete(sessionCacheKey(cookieValue));
  try {
    const decoded = await adminAuth().verifySessionCookie(cookieValue);
    await adminAuth().revokeRefreshTokens(decoded.sub);
  } catch {
    // Already invalid.
  }
}
