import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { env } from "./env";

let app: App | null = null;
let firestore: Firestore | null = null;

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
  if (firestore) return firestore;
  firestore = getFirestore(adminApp());
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}

export function adminAuth() {
  return getAuth(adminApp());
}

export function bucket() {
  return getStorage(adminApp()).bucket();
}
