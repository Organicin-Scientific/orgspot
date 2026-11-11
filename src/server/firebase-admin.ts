import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { env } from "./env";

// This module can be evaluated more than once per process (separate route bundles, dev
// reloads), each with its own copy of firebase-admin. Keeping the app and Firestore on
// globalThis means one set of credentials, one access token and one gRPC channel per
// warm instance instead of one per bundle. Firestore settings may only be applied once.
const shared = globalThis as typeof globalThis & { __adminApp?: App; __adminFirestore?: Firestore };

function adminApp(): App {
  if (shared.__adminApp) return shared.__adminApp;
  if (getApps().length) {
    shared.__adminApp = getApp();
    return shared.__adminApp;
  }
  const e = env();
  const hasServiceAccount = Boolean(e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY);
  const app = initializeApp({
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
  shared.__adminApp = app;
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
