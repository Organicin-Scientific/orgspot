import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, verifySession, type AdminSession } from "../auth/session";
import { env } from "../env";
import { log } from "../logger";
import { enforceRateLimit, type RateLimitName } from "../ratelimit";
import { ApiError, badRequest, forbidden, unauthorized } from "./errors";

type Params = Record<string, string | string[]>;

export interface AdminContext<P extends Params = Params> {
  req: NextRequest;
  session: AdminSession;
  params: P;
}

interface Options {
  /** Rate limit bucket; defaults to "read" for GET/HEAD and "write" otherwise. */
  rateLimit?: RateLimitName;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function jsonError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details ?? null } },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: err.issues[0]?.message ?? "Invalid input",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  log.error("api.unhandled", { err });
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

/** Same-origin check for state-changing requests. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = new URL(env().APP_URL).origin;
  const requestOrigin = req.nextUrl.origin;
  if (!origin || (origin !== allowed && origin !== requestOrigin)) {
    throw forbidden("Cross-origin request rejected");
  }
}

function assertCsrf(req: NextRequest) {
  assertSameOrigin(req);
  const cookie = req.cookies.get(CSRF_COOKIE)?.value;
  const header = req.headers.get(CSRF_HEADER);
  if (!cookie || !header || cookie.length < 16 || cookie !== header) {
    throw forbidden("Invalid or missing CSRF token. Refresh the page and try again.");
  }
}

/**
 * Every protected API route is wrapped by this function. It enforces, in order:
 * 1. a valid, unrevoked Firebase session cookie
 * 2. a live entry on the administrator allowlist
 * 3. CSRF protection for state-changing methods
 * 4. a per-admin rate limit
 * Handlers then validate their own input with zod and perform operation-level checks.
 */
export function withAdmin<P extends Params = Params>(
  handler: (ctx: AdminContext<P>) => Promise<Response>,
  options: Options = {},
) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!session) throw unauthorized();
      if (!SAFE_METHODS.has(req.method)) assertCsrf(req);
      const bucket = options.rateLimit ?? (SAFE_METHODS.has(req.method) ? "read" : "write");
      await enforceRateLimit(bucket, session.uid);
      const params = (await context?.params) ?? ({} as P);
      const res = await handler({ req, session, params });
      res.headers.set("Cache-Control", "no-store");
      return res;
    } catch (err) {
      return jsonError(err);
    }
  };
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T, maxBytes = 1_000_000): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw badRequest("Request body is too large");
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw badRequest("Could not read request body");
  }
  if (raw.length > maxBytes) throw badRequest("Request body is too large");
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(data);
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
