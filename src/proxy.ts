import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = ["/login", "/u/", "/d/", "/__/auth"];

function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  const connect = [
    "'self'",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
    "https://apis.google.com",
    emulator ? `http://${emulator}` : "",
  ];
  const frames = ["'self'", "https://accounts.google.com", "https://apis.google.com", authDomain ? `https://${authDomain}` : ""];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Email previews (sandboxed srcdoc iframes) inherit this policy and rely on inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src ${connect.filter(Boolean).join(" ")}`,
    `frame-src ${frames.filter(Boolean).join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Adds a per-request CSP nonce and sends visitors without a session cookie to the login page.
 * This is only a convenience redirect: every page and API route re-verifies the session.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  if (!isPublic && !request.cookies.has("__session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // brand/ holds the logo and bullet images that email clients fetch without a session.
      source: "/((?!api|d/|brand/|_next/static|_next/image|favicon.ico|icon|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
