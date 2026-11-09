import "server-only";
import { FieldValue, type DocumentReference, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { normalizeEmail } from "@/lib/email-address";
import type { Investor, InvestorStatus, Page } from "@/lib/types";
import { db } from "../firebase-admin";
import { conflict, notFound, badRequest } from "../http/errors";
import { chunk, data, decodeCursor, encodeCursor, isoRequired, str } from "./convert";
import { emailGuardCol, statusForReason, suppressionCol } from "./suppression";
import type { SuppressionReason } from "@/lib/types";

export const investorsCol = () => db().collection("investors");
export const groupsCol = () => db().collection("investorGroups");

export interface InvestorInput {
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
  category: string;
  notes: string;
  groupIds: string[];
}

export function toInvestor(snap: DocumentSnapshot): Investor {
  const d = data(snap);
  return {
    id: snap.id,
    firstName: str(d.firstName),
    lastName: str(d.lastName),
    email: str(d.email),
    organization: str(d.organization),
    category: str(d.category),
    status: (d.status as InvestorStatus) ?? "active",
    groupIds: Array.isArray(d.groupIds) ? (d.groupIds as string[]) : [],
    notes: str(d.notes),
    createdAt: isoRequired(d.createdAt),
    updatedAt: isoRequired(d.updatedAt),
  };
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9@._+-]+/)
    .filter(Boolean);
}

/**
 * Prefix tokens for case-insensitive "starts with" search on name, organisation and email
 * without a third-party search service. Bounded to keep documents small.
 */
export function searchTokens(i: Pick<InvestorInput, "firstName" | "lastName" | "email" | "organization">): string[] {
  const tokens = new Set<string>();
  const add = (w: string, max = 15) => {
    for (let n = 1; n <= Math.min(w.length, max); n++) tokens.add(w.slice(0, n));
  };
  for (const w of words(`${i.firstName} ${i.lastName} ${i.organization}`)) add(w);
  const email = normalizeEmail(i.email);
  add(email, 24);
  const [local, domain] = email.split("@");
  if (local) add(local, 15);
  if (domain) add(domain, 15);
  return [...tokens].slice(0, 300);
}

export function sortKey(i: Pick<InvestorInput, "firstName" | "lastName">, id: string): string {
  return `${i.lastName.trim().toLowerCase()}\u0000${i.firstName.trim().toLowerCase()}\u0000${id}`;
}

function derived(input: InvestorInput, id: string) {
  return {
    email: input.email.trim(),
    emailNormalized: normalizeEmail(input.email),
    searchTokens: searchTokens(input),
    sortKey: sortKey(input, id),
  };
}

export interface ListInvestorsQuery {
  q?: string;
  status?: InvestorStatus;
  category?: string;
  groupId?: string;
  cursor?: string | null;
  limit?: number;
}

export async function listInvestors(query: ListInvestorsQuery): Promise<Page<Investor>> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const terms = words(query.q ?? "").map((t) => t.slice(0, 15));
  let q: Query = investorsCol();
  // Firestore allows a single array-contains per query: search wins, group is then filtered in memory.
  if (terms.length) q = q.where("searchTokens", "array-contains", terms[0]);
  else if (query.groupId) q = q.where("groupIds", "array-contains", query.groupId);
  if (query.status) q = q.where("status", "==", query.status);
  if (query.category) q = q.where("category", "==", query.category);
  q = q.orderBy("sortKey");
  const after = decodeCursor(query.cursor);
  if (after) q = q.startAfter(after);

  const needsMemoryFilter = terms.length > 1 || (terms.length > 0 && Boolean(query.groupId));
  const fetchLimit = needsMemoryFilter ? limit * 4 : limit + 1;
  const snap = await q.limit(fetchLimit).get();
  let docs = snap.docs;
  if (needsMemoryFilter) {
    docs = docs.filter((d) => {
      const tokens = (d.get("searchTokens") as string[]) ?? [];
      const groups = (d.get("groupIds") as string[]) ?? [];
      return terms.every((t) => tokens.includes(t)) && (!query.groupId || groups.includes(query.groupId));
    });
  }
  const page = docs.slice(0, limit);
  const hasMore = needsMemoryFilter ? snap.docs.length === fetchLimit : docs.length > limit;
  const lastScanned = needsMemoryFilter ? snap.docs[snap.docs.length - 1] : page[page.length - 1];
  return {
    items: page.map(toInvestor),
    nextCursor: hasMore && lastScanned ? encodeCursor(str(lastScanned.get("sortKey"))) : null,
  };
}

export async function getInvestor(id: string): Promise<Investor | null> {
  const snap = await investorsCol().doc(id).get();
  return snap.exists ? toInvestor(snap) : null;
}

export async function findInvestorIdByEmail(email: string): Promise<string | null> {
  const snap = await emailGuardCol().doc(normalizeEmail(email)).get();
  return snap.exists ? str(snap.data()?.investorId) || null : null;
}

async function assertGroupsExist(groupIds: string[]) {
  if (!groupIds.length) return;
  const snaps = await db().getAll(...groupIds.map((g) => groupsCol().doc(g)));
  if (snaps.some((s) => !s.exists)) throw badRequest("One or more selected groups no longer exist");
}

/** Create an investor. Email uniqueness is enforced by a guard document in the same transaction. */
export async function createInvestor(input: InvestorInput, actor: string): Promise<Investor> {
  const groupIds = [...new Set(input.groupIds)];
  await assertGroupsExist(groupIds);
  const ref = investorsCol().doc();
  const key = normalizeEmail(input.email);
  await db().runTransaction(async (tx) => {
    const guardRef = emailGuardCol().doc(key);
    const [guard, sup] = await Promise.all([tx.get(guardRef), tx.get(suppressionCol().doc(key))]);
    if (guard.exists) {
      throw conflict("An investor with this email already exists", { investorId: guard.data()?.investorId });
    }
    const status: InvestorStatus = sup.exists ? statusForReason(sup.data()?.reason as SuppressionReason) : "active";
    tx.create(guardRef, { investorId: ref.id });
    tx.create(ref, {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      organization: input.organization.trim(),
      category: input.category.trim(),
      notes: input.notes,
      groupIds,
      status,
      ...derived(input, ref.id),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: actor,
    });
    for (const g of groupIds) tx.update(groupsCol().doc(g), { memberCount: FieldValue.increment(1) });
    tx.create(ref.collection("history").doc(), {
      at: FieldValue.serverTimestamp(),
      actor,
      changes: { created: { from: null, to: "manual" } },
    });
  });
  return (await getInvestor(ref.id))!;
}

const TRACKED_FIELDS = ["firstName", "lastName", "email", "organization", "category", "notes"] as const;

export interface InvestorPatch extends Partial<InvestorInput> {
  /** Admins may only move a contact into "suppressed" here; reactivation goes through the suppression list. */
  status?: "suppressed";
}

export async function updateInvestor(id: string, patch: InvestorPatch, actor: string): Promise<Investor> {
  if (patch.groupIds) await assertGroupsExist([...new Set(patch.groupIds)]);
  await db().runTransaction(async (tx) => {
    const ref = investorsCol().doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Investor not found");
    const current = toInvestor(snap);
    const next: InvestorInput = {
      firstName: patch.firstName ?? current.firstName,
      lastName: patch.lastName ?? current.lastName,
      email: patch.email ?? current.email,
      organization: patch.organization ?? current.organization,
      category: patch.category ?? current.category,
      notes: patch.notes ?? current.notes,
      groupIds: patch.groupIds ? [...new Set(patch.groupIds)] : current.groupIds,
    };
    const oldKey = normalizeEmail(current.email);
    const newKey = normalizeEmail(next.email);
    let supSnap: DocumentSnapshot | null = null;
    if (oldKey !== newKey) {
      const [guard, sup] = await Promise.all([
        tx.get(emailGuardCol().doc(newKey)),
        tx.get(suppressionCol().doc(newKey)),
      ]);
      if (guard.exists) throw conflict("Another investor already uses this email");
      supSnap = sup;
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of TRACKED_FIELDS) {
      const before = current[f];
      const after = typeof next[f] === "string" ? (next[f] as string).trim() : next[f];
      if (before !== after) changes[f] = { from: before, to: after };
    }
    const added = next.groupIds.filter((g) => !current.groupIds.includes(g));
    const removed = current.groupIds.filter((g) => !next.groupIds.includes(g));
    if (added.length || removed.length) changes.groups = { from: current.groupIds, to: next.groupIds };

    let status = current.status;
    if (patch.status === "suppressed" && current.status === "active") status = "suppressed";
    if (supSnap?.exists) status = statusForReason(supSnap.data()?.reason as SuppressionReason);
    if (status !== current.status) changes.status = { from: current.status, to: status };

    if (Object.keys(changes).length === 0) return;

    if (oldKey !== newKey) {
      tx.delete(emailGuardCol().doc(oldKey));
      tx.create(emailGuardCol().doc(newKey), { investorId: id });
    }
    tx.update(ref, {
      firstName: next.firstName.trim(),
      lastName: next.lastName.trim(),
      organization: next.organization.trim(),
      category: next.category.trim(),
      notes: next.notes,
      groupIds: next.groupIds,
      status,
      ...derived(next, id),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const g of added) tx.update(groupsCol().doc(g), { memberCount: FieldValue.increment(1) });
    for (const g of removed) tx.update(groupsCol().doc(g), { memberCount: FieldValue.increment(-1) });
    if (status === "suppressed" && current.status === "active" && patch.status === "suppressed") {
      tx.set(suppressionCol().doc(newKey), {
        email: newKey,
        reason: "manual",
        source: actor,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.create(ref.collection("history").doc(), { at: FieldValue.serverTimestamp(), actor, changes });
  });
  return (await getInvestor(id))!;
}

/**
 * Delete a contact record. Campaign recipient snapshots are retained for history, and
 * any suppression entry for the address remains in force if the contact is re-added.
 */
export async function deleteInvestor(id: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const ref = investorsCol().doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Investor not found");
    const inv = toInvestor(snap);
    tx.delete(emailGuardCol().doc(normalizeEmail(inv.email)));
    for (const g of inv.groupIds) tx.update(groupsCol().doc(g), { memberCount: FieldValue.increment(-1) });
    tx.delete(ref);
  });
  await db().recursiveDelete(investorsCol().doc(id).collection("history"));
}

export type BulkAction =
  | { type: "addToGroup"; groupId: string }
  | { type: "removeFromGroup"; groupId: string }
  | { type: "suppress" }
  | { type: "delete" };

export async function bulkInvestors(ids: string[], action: BulkAction, actor: string): Promise<{ changed: number }> {
  const unique = [...new Set(ids)].slice(0, 1000);
  if (action.type === "addToGroup" || action.type === "removeFromGroup") await assertGroupsExist([action.groupId]);
  let changed = 0;
  if (action.type === "delete") {
    for (const id of unique) {
      try {
        await deleteInvestor(id);
        changed++;
      } catch {
        // Already removed.
      }
    }
    return { changed };
  }
  for (const part of chunk(unique, 100)) {
    changed += await db().runTransaction(async (tx) => {
      const refs = part.map((id) => investorsCol().doc(id));
      const snaps = await tx.getAll(...refs);
      let n = 0;
      let groupDelta = 0;
      const supWrites: DocumentReference[] = [];
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const inv = toInvestor(snap);
        if (action.type === "addToGroup" && !inv.groupIds.includes(action.groupId)) {
          tx.update(snap.ref, { groupIds: FieldValue.arrayUnion(action.groupId), updatedAt: FieldValue.serverTimestamp() });
          groupDelta++;
          n++;
        } else if (action.type === "removeFromGroup" && inv.groupIds.includes(action.groupId)) {
          tx.update(snap.ref, { groupIds: FieldValue.arrayRemove(action.groupId), updatedAt: FieldValue.serverTimestamp() });
          groupDelta--;
          n++;
        } else if (action.type === "suppress" && inv.status === "active") {
          tx.update(snap.ref, { status: "suppressed", updatedAt: FieldValue.serverTimestamp() });
          tx.create(snap.ref.collection("history").doc(), {
            at: FieldValue.serverTimestamp(),
            actor,
            changes: { status: { from: "active", to: "suppressed" } },
          });
          supWrites.push(suppressionCol().doc(normalizeEmail(inv.email)));
          n++;
        }
      }
      if (groupDelta !== 0 && (action.type === "addToGroup" || action.type === "removeFromGroup")) {
        tx.update(groupsCol().doc(action.groupId), { memberCount: FieldValue.increment(groupDelta) });
      }
      for (const ref of supWrites) {
        tx.set(ref, { email: ref.id, reason: "manual", source: actor, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      return n;
    });
  }
  return { changed };
}

export interface HistoryEntry {
  id: string;
  at: string;
  actor: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export async function investorHistory(id: string, limit = 50): Promise<HistoryEntry[]> {
  const snap = await investorsCol().doc(id).collection("history").orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) => ({
    id: d.id,
    at: isoRequired(d.get("at")),
    actor: str(d.get("actor")),
    changes: (d.get("changes") as HistoryEntry["changes"]) ?? {},
  }));
}

export async function distinctCategories(): Promise<string[]> {
  const snap = await db().collection("meta").doc("investorCategories").get();
  const list = (snap.data()?.values as string[]) ?? [];
  return [...new Set(list)].sort((a, b) => a.localeCompare(b));
}

export async function rememberCategories(categories: string[]) {
  const clean = [...new Set(categories.map((c) => c.trim()).filter(Boolean))].slice(0, 100);
  if (!clean.length) return;
  await db()
    .collection("meta")
    .doc("investorCategories")
    .set({ values: FieldValue.arrayUnion(...clean) }, { merge: true });
}

/** Iterate every investor matching a group (or all) in pages, never loading the whole collection at once. */
export async function* iterateInvestors(opts: { groupId?: string; pageSize?: number } = {}) {
  const size = opts.pageSize ?? 500;
  let last: string | null = null;
  for (;;) {
    let q: Query = investorsCol();
    if (opts.groupId) q = q.where("groupIds", "array-contains", opts.groupId);
    q = q.orderBy("sortKey").limit(size);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) yield toInvestor(d);
    if (snap.size < size) return;
    last = str(snap.docs[snap.docs.length - 1].get("sortKey"));
  }
}

export async function countInvestors(status?: InvestorStatus): Promise<number> {
  const q = status ? investorsCol().where("status", "==", status) : investorsCol();
  const agg = await q.count().get();
  return agg.data().count;
}
