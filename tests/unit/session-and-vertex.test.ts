import { beforeEach, describe, expect, it, vi } from "vitest";

const envValues: Record<string, unknown> = {};
vi.mock("@/server/env", () => ({ env: () => envValues }));
vi.mock("@/server/logger", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const verifySessionCookie = vi.fn();
const revokeRefreshTokens = vi.fn();
vi.mock("@/server/firebase-admin", () => ({
  adminAuth: () => ({ verifySessionCookie, revokeRefreshTokens }),
}));

const getAdmin = vi.fn();
vi.mock("@/server/auth/admins", () => ({ getAdmin, bindAdminUid: vi.fn() }));

const { vertexApiEndpoint, vertexLocation } = await import("../../src/server/ai/config");
const { verifySession, revokeSession, clearSessionCache, SESSION_CHECK_CACHE_MS } = await import(
  "../../src/server/auth/session"
);

describe("vertex location", () => {
  beforeEach(() => {
    delete envValues.VERTEX_GEMINI_LOCATION;
  });

  it("defaults to the global location with its base endpoint", () => {
    expect(vertexLocation()).toBe("global");
    expect(vertexApiEndpoint("global")).toBe("aiplatform.googleapis.com");
  });

  it("leaves regional locations to the SDK's own host", () => {
    envValues.VERTEX_GEMINI_LOCATION = "us-east4";
    expect(vertexLocation()).toBe("us-east4");
    expect(vertexApiEndpoint("us-east4")).toBeUndefined();
  });
});

describe("session check cache", () => {
  beforeEach(() => {
    clearSessionCache();
    vi.useRealTimers();
    verifySessionCookie.mockReset().mockResolvedValue({ uid: "u1", email: "a@example.com", email_verified: true, sub: "u1" });
    getAdmin.mockReset().mockResolvedValue({ email: "a@example.com", active: true, role: "admin", uid: "u1" });
  });

  it("reuses a successful check within the window", async () => {
    expect(await verifySession("cookie-1")).toEqual({ uid: "u1", email: "a@example.com" });
    expect(await verifySession("cookie-1")).toEqual({ uid: "u1", email: "a@example.com" });
    expect(verifySessionCookie).toHaveBeenCalledTimes(1);
    expect(getAdmin).toHaveBeenCalledTimes(1);
  });

  it("checks again once the window has passed", async () => {
    vi.useFakeTimers();
    await verifySession("cookie-1");
    vi.advanceTimersByTime(SESSION_CHECK_CACHE_MS + 1);
    await verifySession("cookie-1");
    expect(verifySessionCookie).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed check", async () => {
    getAdmin.mockResolvedValue(null);
    expect(await verifySession("cookie-1")).toBeNull();
    expect(await verifySession("cookie-1")).toBeNull();
    expect(getAdmin).toHaveBeenCalledTimes(2);
  });

  it("drops the cached entry on sign-out", async () => {
    await verifySession("cookie-1");
    await revokeSession("cookie-1");
    await verifySession("cookie-1");
    expect(verifySessionCookie).toHaveBeenCalledTimes(3);
  });
});
