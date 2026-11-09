/**
 * Shared helpers for Firebase emulator integration tests.
 * Synthetic data only; env must be set before importing server modules (see setup file).
 */
import { randomBytes } from "node:crypto";
import { Webhook } from "svix";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { resetEnvCache } from "@/server/env";
import { clearAdminCache } from "@/server/auth/admins";
import { adminAuth, db } from "@/server/firebase-admin";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "@/server/auth/session";
import { createInvestor } from "@/server/db/investors";
import { createGroup } from "@/server/db/groups";
import { saveSettings } from "@/server/db/settings";
import { createUpdate, saveUpdate } from "@/server/db/updates";
import { EMPTY_DOC } from "@/lib/content/schema";
import { runWorker } from "@/server/campaigns/worker";

const PROJECT_ID = "demo-organicin";
const EMULATOR_CLEAR_URL = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export function resetServerModuleCaches() {
  resetEnvCache();
  clearAdminCache();
}

export async function clearEmulatorFirestore() {
  const res = await fetch(EMULATOR_CLEAR_URL, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to clear Firestore emulator: ${res.status} ${text}`);
  }
}

export async function seedSendReadySettings(actorEmail: string) {
  await saveSettings(
    {
      branding: {
        companyName: "Example Co",
        logoAssetId: null,
        primaryColor: "#1f6f5c",
        textColor: "#1f2937",
        fontFamily: "helvetica",
      },
      sender: { fromName: "Example Investor Relations", fromEmail: "ir@updates.example.com", replyTo: "reply@updates.example.com" },
      postalAddress: "123 Example St, Example City, EX 12345",
      footerNote: "Synthetic footer for tests.",
    },
    actorEmail,
  );
}

export async function ensureAdminAllowlist(email: string) {
  await db()
    .collection("admins")
    .doc(email.toLowerCase())
    .set({ email: email.toLowerCase(), active: true, role: "admin", uid: null }, { merge: true });
}

/** Same flow as dev-login: custom token -> emulator REST -> id token */
export async function mintIdTokenForEmail(email: string): Promise<string> {
  await ensureAdminAllowlist(email);
  let uid: string;
  try {
    uid = (await adminAuth().getUserByEmail(email)).uid;
  } catch {
    uid = (await adminAuth().createUser({ email, emailVerified: true })).uid;
  }
  const customToken = await adminAuth().createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
  const r = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=emulator`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await r.json()) as { idToken?: string; error?: { message?: string } };
  if (!body.idToken) throw new Error(body.error?.message ?? "signInWithCustomToken failed");
  return body.idToken;
}

export async function sessionHeadersForAdmin(email: string): Promise<Record<string, string>> {
  const { createSession } = await import("@/server/auth/session");
  const idToken = await mintIdTokenForEmail(email);
  const { cookie, csrf } = await createSession(idToken);
  return {
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}; ${CSRF_COOKIE}=${encodeURIComponent(csrf)}`,
    [CSRF_HEADER]: csrf,
  };
}

export function adminRequest(
  method: string,
  pathname: string,
  opts: {
    headers?: Record<string, string>;
    body?: string;
    origin?: string | null;
  } = {},
): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  const h = new Headers();
  h.set("host", "localhost:3000");
  if (opts.origin !== null) h.set("origin", opts.origin ?? "http://localhost:3000");
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) if (v !== undefined) h.set(k, v);
  }
  return new NextRequest(url, { method, headers: h, body: opts.body });
}

export async function createSyntheticGroupAndInvestors(actorEmail: string) {
  const g = await createGroup({ name: `Test group ${randomBytes(4).toString("hex")}`, description: "Integration test" }, actorEmail);
  const inv1 = await createInvestor(
    {
      firstName: "Alpha",
      lastName: "One",
      email: `alpha.one.${randomBytes(4).toString("hex")}@example.com`,
      organization: "Example Ventures",
      category: "Angel",
      notes: "",
      groupIds: [g.id],
    },
    actorEmail,
  );
  const inv2 = await createInvestor(
    {
      firstName: "Beta",
      lastName: "Two",
      email: `beta.retry.${randomBytes(4).toString("hex")}@flaky.test`,
      organization: "Sample Capital",
      category: "VC",
      notes: "",
      groupIds: [g.id],
    },
    actorEmail,
  );
  const suppressedEmail = `gone.${randomBytes(4).toString("hex")}@example.com`;
  await db()
    .collection("suppressionList")
    .doc(suppressedEmail.toLowerCase())
    .set({
      email: suppressedEmail.toLowerCase(),
      reason: "bounce",
      source: "test-seed",
      createdAt: FieldValue.serverTimestamp(),
    });
  const inv3 = await createInvestor(
    {
      firstName: "Suppressed",
      lastName: "User",
      email: suppressedEmail,
      organization: "No Mail LLC",
      category: "Strategic",
      notes: "",
      groupIds: [g.id],
    },
    actorEmail,
  );
  const postSuppressEmail = `post.${randomBytes(4).toString("hex")}@example.com`;
  const inv4 = await createInvestor(
    {
      firstName: "Late",
      lastName: "Suppress",
      email: postSuppressEmail,
      organization: "Example LLC",
      category: "Angel",
      notes: "",
      groupIds: [g.id],
    },
    actorEmail,
  );
  return { groupId: g.id, investors: [inv1, inv2, inv3, inv4], suppressedEmail, postSuppressEmail };
}

export async function createReadyUpdateForCampaign(actorEmail: string) {
  const u = await createUpdate(actorEmail, { blank: true });
  const saved = await saveUpdate(
    u.id,
    {
      expectedVersion: u.version,
      title: "Synthetic Q4 update",
      subject: "Synthetic investor update",
      previewText: "Preview line for tests.",
      content: EMPTY_DOC,
      pdfDelivery: "none",
    },
    actorEmail,
  );
  return saved;
}

export function signResendWebhookPayload(secret: string, id: string, payload: unknown): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(payload);
  const wh = new Webhook(secret);
  const timestamp = new Date();
  const signature = wh.sign(id, timestamp, Buffer.from(body, "utf8"));
  return {
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
  };
}

/**
 * Run the worker until `done` returns true or max rounds.
 * We cannot rely on `runWorker().remaining`: when the next retry is scheduled seconds
 * ahead, the worker reports no immediate remainder but the campaign is still in flight.
 */
export async function drainWorkerUntil(
  done: () => Promise<boolean>,
  maxRounds = 40,
  budgetMs = 60_000,
) {
  for (let i = 0; i < maxRounds; i++) {
    if (await done()) return;
    await runWorker(budgetMs);
  }
  if (!(await done())) {
    throw new Error("drainWorkerUntil: exceeded max rounds without completing");
  }
}

export { Timestamp };
