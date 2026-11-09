"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence, type Auth } from "firebase/auth";

let auth: Auth | null = null;

/**
 * The client SDK is used only to complete Google sign-in and MFA. Credentials are held in
 * memory and exchanged immediately for an HttpOnly server session cookie.
 */
export async function clientAuth(): Promise<Auth> {
  if (auth) return auth;
  const app: FirebaseApp =
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-key",
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-organicin",
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  auth = getAuth(app);
  const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  const local =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  // Never point hosted previews/production at a local Auth emulator (common .env copy mistake).
  if (emulator && local) connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
  await setPersistence(auth, inMemoryPersistence);
  return auth;
}
