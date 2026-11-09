import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminRequest,
  clearEmulatorFirestore,
  resetServerModuleCaches,
  seedSendReadySettings,
  sessionHeadersForAdmin,
} from "./helpers";

describe("withAdmin (investors API)", () => {
  const allowEmail = "admin.allow@example.com";

  let GET: typeof import("@/app/api/investors/route").GET;
  let POST: typeof import("@/app/api/investors/route").POST;

  beforeEach(async () => {
    resetServerModuleCaches();
    await clearEmulatorFirestore();
    await seedSendReadySettings(allowEmail);
    const mod = await import("@/app/api/investors/route");
    GET = mod.GET;
    POST = mod.POST;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no session cookie", async () => {
    const res = await GET(adminRequest("GET", "/api/investors"), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
  });

  it("returns 401 when the session cookie is invalid", async () => {
    const res = await GET(
      adminRequest("GET", "/api/investors", {
        headers: { cookie: "__session=not-a-real-session-cookie" },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Firebase user is not on the admin allowlist", async () => {
    const { adminAuth } = await import("@/server/firebase-admin");
    const email = `outsider.${Date.now()}@example.com`;
    const uid = (await adminAuth().createUser({ email, emailVerified: true })).uid;
    const customToken = await adminAuth().createCustomToken(uid);
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
    const r = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    const body = (await r.json()) as { idToken?: string };
    expect(body.idToken).toBeDefined();
    const cookie = await adminAuth().createSessionCookie(body.idToken!, { expiresIn: 60 * 60 * 1000 });

    const res = await GET(adminRequest("GET", "/api/investors", { headers: { cookie: `__session=${encodeURIComponent(cookie)}` } }), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for POST without the CSRF header (cookie present)", async () => {
    const h = await sessionHeadersForAdmin(allowEmail);
    const res = await POST(
      adminRequest("POST", "/api/investors", {
        headers: {
          cookie: h.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "User",
          email: `csrf.missing.${Date.now()}@example.com`,
          organization: "Org",
          category: "Angel",
          notes: "",
          groupIds: [],
        }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("forbidden");
  });

  it("returns 403 for POST with a disallowed cross-origin Origin", async () => {
    const h = await sessionHeadersForAdmin(allowEmail);
    const { CSRF_HEADER } = await import("@/server/auth/session");
    const res = await POST(
      adminRequest("POST", "/api/investors", {
        origin: "https://evil.example.com",
        headers: {
          cookie: h.cookie,
          "content-type": "application/json",
          [CSRF_HEADER]: h[CSRF_HEADER],
        },
        body: JSON.stringify({
          firstName: "Test",
          lastName: "User",
          email: `cors.bad.${Date.now()}@example.com`,
          organization: "Org",
          category: "Angel",
          notes: "",
          groupIds: [],
        }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 200/201 for an allowlisted admin with valid session and CSRF", async () => {
    const h = await sessionHeadersForAdmin(allowEmail);
    const { CSRF_HEADER } = await import("@/server/auth/session");
    const getRes = await GET(adminRequest("GET", "/api/investors", { headers: { cookie: h.cookie } }), { params: Promise.resolve({}) });
    expect(getRes.status).toBe(200);

    const postRes = await POST(
      adminRequest("POST", "/api/investors", {
        headers: {
          cookie: h.cookie,
          "content-type": "application/json",
          [CSRF_HEADER]: h[CSRF_HEADER],
        },
        body: JSON.stringify({
          firstName: "Gamma",
          lastName: "Three",
          email: `gamma.${Date.now()}@example.com`,
          organization: "Example LLC",
          category: "Angel",
          notes: "",
          groupIds: [],
        }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(postRes.status).toBe(201);
  });
});
