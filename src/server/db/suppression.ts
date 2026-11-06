import "server-only";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { normalizeEmail } from "@/lib/email-address";
import type { InvestorStatus, Page, SuppressionEntry, SuppressionReason } from "@/lib/types";
import { db } from "../firebase-admin";
import { chunk, data, decodeCursor, encodeCursor, isoRequired, str } from "./convert";

export const suppressionCol = () => db().collection("suppressionList");
export const emailGuardCol = () => db().collection("investorEmails");

export function statusForReason(reason: SuppressionReason): InvestorStatus {
  switch (reason) {
    case "unsubscribe":
      return "unsubscribed";
    case "bounce":
      return "bounced";
    default:
      return "suppressed";
  }
}

/** Returns the set of normalised addresses that are on the global suppression list. */
export async function suppressedSet(emails: string[]): Promise<Map<string, SuppressionReason>> {
  const out = new Map<string, SuppressionReason>();
  const unique = [...new Set(emails.map(normalizeEmail))];
  for (const part of chunk(unique, 300)) {
    const snaps = await db().getAll(...part.map((e) => suppressionCol().doc(e)));
    for (const s of snaps) if (s.exists) out.set(s.id, (s.data()?.reason as SuppressionReason) ?? "manual");
  }
  return out;
}

/**
 * Add an address to the global suppression list inside an existing transaction and
 * mirror the status onto the matching investor record. Reads must happen before writes,
 * so callers pass in the transaction before performing their own writes.
 */
export async function suppressInTx(
  tx: Transaction,
  email: string,
  reason: SuppressionReason,
  source: string,
): Promise<() => void> {
  const key = normalizeEmail(email);
  const supRef = suppressionCol().doc(key);
  const guardRef = emailGuardCol().doc(key);
  const [supSnap, guardSnap] = await Promise.all([tx.get(supRef), tx.get(guardRef)]);
  const investorId = guardSnap.exists ? str(guardSnap.data()?.investorId) : "";
  const investorRef = investorId ? db().collection("investors").doc(investorId) : null;
  const investorSnap = investorRef ? await tx.get(investorRef) : null;

  return () => {
    if (!supSnap.exists) {
      tx.set(supRef, { email: key, reason, source, createdAt: FieldValue.serverTimestamp() });
    } else if (reason === "complaint" && supSnap.data()?.reason !== "complaint") {
      // Complaints are the strongest signal; record them even if already suppressed.
      tx.update(supRef, { reason, source, updatedAt: FieldValue.serverTimestamp() });
    }
    if (investorRef && investorSnap?.exists) {
      const current = investorSnap.data()?.status as InvestorStatus;
      const next = statusForReason(reason);
      if (current === "active" || (reason === "complaint" && current !== "suppressed")) {
        tx.update(investorRef, { status: next, updatedAt: FieldValue.serverTimestamp() });
        tx.create(investorRef.collection("history").doc(), {
          at: FieldValue.serverTimestamp(),
          actor: source,
          changes: { status: { from: current, to: next } },
        });
      }
    }
  };
}

export async function addSuppression(email: string, reason: SuppressionReason, source: string) {
  await db().runTransaction(async (tx) => {
    const write = await suppressInTx(tx, email, reason, source);
    write();
  });
}

/**
 * Removing a suppression is a deliberate admin action (e.g. an investor asked to be
 * re-subscribed). It reactivates the matching investor record.
 */
export async function removeSuppression(email: string, actor: string): Promise<boolean> {
  const key = normalizeEmail(email);
  return db().runTransaction(async (tx) => {
    const supRef = suppressionCol().doc(key);
    const guardRef = emailGuardCol().doc(key);
    const [supSnap, guardSnap] = await Promise.all([tx.get(supRef), tx.get(guardRef)]);
    const investorId = guardSnap.exists ? str(guardSnap.data()?.investorId) : "";
    const investorRef = investorId ? db().collection("investors").doc(investorId) : null;
    const investorSnap = investorRef ? await tx.get(investorRef) : null;
    if (!supSnap.exists && !(investorSnap?.exists && investorSnap.data()?.status !== "active")) return false;
    if (supSnap.exists) tx.delete(supRef);
    if (investorRef && investorSnap?.exists && investorSnap.data()?.status !== "active") {
      tx.update(investorRef, { status: "active", updatedAt: FieldValue.serverTimestamp() });
      tx.create(investorRef.collection("history").doc(), {
        at: FieldValue.serverTimestamp(),
        actor,
        changes: { status: { from: investorSnap.data()?.status, to: "active" } },
      });
    }
    return true;
  });
}

export async function getSuppression(email: string): Promise<SuppressionEntry | null> {
  const snap = await suppressionCol().doc(normalizeEmail(email)).get();
  if (!snap.exists) return null;
  const d = data(snap);
  return {
    email: snap.id,
    reason: d.reason as SuppressionReason,
    source: str(d.source),
    createdAt: isoRequired(d.createdAt),
  };
}

export async function listSuppressions(cursor: string | null, limit = 50): Promise<Page<SuppressionEntry>> {
  let q = suppressionCol().orderBy("email").limit(limit + 1);
  const after = decodeCursor(cursor);
  if (after) q = q.startAfter(after);
  const snap = await q.get();
  const docs = snap.docs.slice(0, limit);
  return {
    items: docs.map((s) => {
      const d = data(s);
      return { email: s.id, reason: d.reason as SuppressionReason, source: str(d.source), createdAt: isoRequired(d.createdAt) };
    }),
    nextCursor: snap.docs.length > limit ? encodeCursor(docs[docs.length - 1].id) : null,
  };
}
