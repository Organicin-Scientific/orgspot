import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { env } from "./env";

let app: App | null = null;

// firebase-admin is shared process-wide, but this module can be evaluated more than once
// (separate route bundles, dev reloads). Firestore settings may only be applied once.
const shared = globalThis as typeof globalThis & { __adminFirestore?: Firestore };

function adminApp(): App {
  if (app) return app;
  if (getApps().length) {
    app = getApp();
    return app;
  }
  const e = env();
  const hasServiceAccount = Boolean(e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY);
  app = initializeApp({
    projectId: e.FIREBASE_PROJECT_ID,
    storageBucket: e.FIREBASE_STORAGE_BUCKET,
    ...(hasServiceAccount
      ? {
          credential: cert({
            projectId: e.FIREBASE_PROJECT_ID,
            clientEmail: e.FIREBASE_CLIENT_EMAIL,
            // Vercel stores multi-line secrets with escaped newlines.
            privateKey: e.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
          }),
        }
      : {}),
  });
  return app;
}

export function db(): Firestore {
  if (shared.__adminFirestore) return shared.__adminFirestore;
  const firestore = getFirestore(adminApp());
  firestore.settings({ ignoreUndefinedProperties: true });
  shared.__adminFirestore = firestore;
  return firestore;
}

export function adminAuth() {
  return getAuth(adminApp());
}

export function bucket() {
  return getStorage(adminApp()).bucket();
}
