import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeEmail } from "@/lib/email-address";
import { db } from "../firebase-admin";

export interface AdminRecord {
  email: string;
  active: boolean;
  role: "admin";
  uid: string | null;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: AdminRecord | null }>();

/**
 * Admin access is an explicit allowlist keyed by normalised email. Being in a particular
 * Google Workspace domain grants nothing on its own.
 */
export async function getAdmin(email: string, { fresh = false } = {}): Promise<AdminRecord | null> {
  const key = normalizeEmail(email);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const snap = await db().collection("admins").doc(key).get();
  const data = snap.data();
  const value: AdminRecord | null =
    snap.exists && data?.active === true && data?.role === "admin"
      ? { email: key, active: true, role: "admin", uid: (data.uid as string) ?? null }
      : null;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function bindAdminUid(email: string, uid: string) {
  const ref = db().collection("admins").doc(normalizeEmail(email));
  await ref.set({ uid, lastLoginAt: FieldValue.serverTimestamp() }, { merge: true });
}

export function clearAdminCache() {
  cache.clear();
}
