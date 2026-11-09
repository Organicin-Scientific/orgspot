import type { NextConfig } from "next";

const firebaseAuthHost = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  ? `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`
  : null;

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  // Every screen is per-request and session-bound; nothing benefits from static caching.
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["firebase-admin", "@react-pdf/renderer", "exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages get frame-ancestors 'none' from the proxy CSP; API responses (PDF previews) may be framed by the app itself.
      { source: "/api/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      { source: "/((?!api).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
    ];
  },
  async rewrites() {
    // Lets Firebase Auth use this app's own domain as authDomain (avoids third-party cookie issues).
    return firebaseAuthHost ? [{ source: "/__/auth/:path*", destination: `${firebaseAuthHost}/__/auth/:path*` }] : [];
  },
};

export default nextConfig;
