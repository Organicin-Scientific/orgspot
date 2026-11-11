import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

function req(path: string, cookie?: string) {
  const url = new URL(path, "https://investor.example.com");
  if (cookie) return new NextRequest(url, { headers: { cookie: `__session=${cookie}` } });
  return new NextRequest(url);
}

describe("proxy", () => {
  it("does not attach app CSP to Firebase auth handler rewrites", () => {
    const res = proxy(req("/__/auth/handler?apiKey=x&appName=%5BDEFAULT%5D"));
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("still adds CSP to the login page", () => {
    const res = proxy(req("/login"));
    expect(res.headers.get("Content-Security-Policy")).toMatch(/script-src/);
  });

  it("still redirects unauthenticated users away from protected pages", () => {
    const res = proxy(req("/updates"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/login/);
  });
});
