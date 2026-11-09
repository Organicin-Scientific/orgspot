/**
 * CLI: manage Firestore `admins` collection.
 * Usage: npx tsx scripts/admin.ts <add|remove|list> [email]
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getApps, initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  const p = process as NodeJS.Process & { loadEnvFile?: (path: string) => void };
  if (typeof p.loadEnvFile === "function") {
    p.loadEnvFile(envLocalPath);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeAdminDocId(email: string): string {
  return email.trim().toLowerCase();
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function initFirebase(): void {
  if (getApps().length > 0) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    fail("FIREBASE_PROJECT_ID is required.");
  }

  const allowed = process.env.ALLOWED_FIREBASE_PROJECT_ID?.trim();
  if (allowed && projectId !== allowed) {
    fail(
      `Refusing to run: FIREBASE_PROJECT_ID (${projectId}) does not match ALLOWED_FIREBASE_PROJECT_ID (${allowed}).`,
    );
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = rawKey?.replace(/\\n/g, "\n");

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId });
    return;
  }

  if (clientEmail && privateKey) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

function parseArgs(): { cmd: "add" | "remove" | "list"; email?: string } {
  const [, , cmd, email] = process.argv;
  if (cmd !== "add" && cmd !== "remove" && cmd !== "list") {
    fail("Usage: npx tsx scripts/admin.ts <add|remove|list> [email]");
  }
  if ((cmd === "add" || cmd === "remove") && !email) {
    fail(`Usage: npx tsx scripts/admin.ts ${cmd} <email>`);
  }
  if (cmd === "list" && email) {
    fail("Usage: npx tsx scripts/admin.ts list");
  }
  if ((cmd === "add" || cmd === "remove") && email && !EMAIL_RE.test(email.trim())) {
    fail("Invalid email format.");
  }
  return { cmd, email: email?.trim() };
}

async function cmdAdd(email: string): Promise<void> {
  const db = getFirestore();
  const id = normalizeAdminDocId(email);
  const ref = db.collection("admins").doc(id);
  await ref.set(
    {
      email: id,
      role: "admin",
      active: true,
      addedAt: FieldValue.serverTimestamp(),
      addedBy: "cli",
    },
    { merge: true },
  );
  console.log(`Added admin: ${id}`);
}

async function cmdRemove(email: string): Promise<void> {
  const db = getFirestore();
  const id = normalizeAdminDocId(email);
  const ref = db.collection("admins").doc(id);
  await ref.set(
    {
      active: false,
      removedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`Marked inactive: ${id}`);

  try {
    const user = await getAuth().getUserByEmail(id);
    await getAuth().revokeRefreshTokens(user.uid);
    console.log("Revoked refresh tokens for Auth user.");
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code?: string }).code) : "";
    if (code.includes("user-not-found") || code === "auth/user-not-found") {
      console.log("No Auth user found for that email (skipped).");
    } else {
      console.error("Auth revoke failed:", code || "(unknown)");
    }
  }
}

async function cmdList(): Promise<void> {
  const db = getFirestore();
  const snap = await db.collection("admins").get();
  if (snap.empty) {
    console.log("No admin documents.");
    return;
  }
  const rows = snap.docs
    .map((d) => {
      const x = d.data() as { email?: unknown; active?: unknown };
      const em = typeof x.email === "string" ? x.email : d.id;
      const active = typeof x.active === "boolean" ? x.active : false;
      return { email: em, active };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
  for (const { email, active } of rows) {
    console.log(`${email}\tactive=${active}`);
  }
}

async function main(): Promise<void> {
  const { cmd, email } = parseArgs();
  initFirebase();

  if (cmd === "add" && email) await cmdAdd(email);
  else if (cmd === "remove" && email) await cmdRemove(email);
  else if (cmd === "list") await cmdList();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
