import "server-only";
import { Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";

export function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export function isoRequired(value: unknown): string {
  return iso(value) ?? new Date(0).toISOString();
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function data(snap: DocumentSnapshot): Record<string, unknown> {
  return (snap.data() ?? {}) as Record<string, unknown>;
}

/** Chunk an array for Firestore batch/`in` limits. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function encodeCursor(value: string | null): string | null {
  return value ? Buffer.from(value, "utf8").toString("base64url") : null;
}

export function decodeCursor(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded.length > 0 && decoded.length < 500 ? decoded : null;
  } catch {
    return null;
  }
}
