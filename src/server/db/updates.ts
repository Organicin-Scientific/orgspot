import "server-only";
import { FieldValue, Timestamp, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { EMPTY_DOC, parseDoc, type DocNode } from "@/lib/content/schema";
import { migrateLegacyMetrics, starterDocument } from "@/lib/content/template";
import type { ContentBlock, Page, PdfDelivery, UpdateDoc, UpdateRevision, UpdateStatus, UpdateSummary } from "@/lib/types";
import { db } from "../firebase-admin";
import { badRequest, conflict, notFound } from "../http/errors";
import { data, decodeCursor, encodeCursor, iso, isoRequired, num, str } from "./convert";

export const updatesCol = () => db().collection("updates");
export const blocksCol = () => db().collection("contentBlocks");

const EDITABLE: UpdateStatus[] = ["draft", "ready"];
const AUTOSAVE_REVISION_INTERVAL_MS = 10 * 60_000;

function contentOf(raw: unknown): DocNode {
  const parsed = parseDoc(raw);
  return parsed.ok ? parsed.doc : EMPTY_DOC;
}

/** Drafts still on the retired metrics strip open with the standing strip and its prompts. Sent updates keep what went out. */
function editableContentOf(raw: unknown, status: UpdateStatus): DocNode {
  const doc = contentOf(raw);
  return EDITABLE.includes(status) ? migrateLegacyMetrics(doc) : doc;
}

export function toUpdate(snap: DocumentSnapshot): UpdateDoc {
  const d = data(snap);
  return {
    id: snap.id,
    title: str(d.title),
    subject: str(d.subject),
    previewText: str(d.previewText),
    content: editableContentOf(d.content, (d.status as UpdateStatus) ?? "draft"),
    bannerAssetId: typeof d.bannerAssetId === "string" ? d.bannerAssetId : null,
    attachmentIds: Array.isArray(d.attachmentIds) ? (d.attachmentIds as string[]) : [],
    pdfDelivery: (d.pdfDelivery as PdfDelivery) ?? "attach",
    status: (d.status as UpdateStatus) ?? "draft",
    version: num(d.version, 1),
    createdBy: str(d.createdBy),
    updatedBy: str(d.updatedBy),
    createdAt: isoRequired(d.createdAt),
    updatedAt: isoRequired(d.updatedAt),
    sentAt: iso(d.sentAt),
    pendingCampaignId: typeof d.pendingCampaignId === "string" ? d.pendingCampaignId : null,
    sentCampaignId: typeof d.sentCampaignId === "string" ? d.sentCampaignId : null,
    duplicatedFrom: typeof d.duplicatedFrom === "string" ? d.duplicatedFrom : null,
  };
}

export function toSummary(snap: DocumentSnapshot): UpdateSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content, ...rest } = toUpdate(snap);
  return rest;
}

function titleTokens(title: string, subject: string): string[] {
  const tokens = new Set<string>();
  for (const w of `${title} ${subject}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    for (let n = 1; n <= Math.min(w.length, 15); n++) tokens.add(w.slice(0, n));
  }
  return [...tokens].slice(0, 200);
}

export async function listUpdates(opts: {
  status?: UpdateStatus;
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<Page<UpdateSummary>> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  let q: Query = updatesCol();
  const term = (opts.q ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0];
  if (term) q = q.where("searchTokens", "array-contains", term.slice(0, 15));
  if (opts.status) q = q.where("status", "==", opts.status);
  q = q.orderBy("updatedAt", "desc").limit(limit + 1);
  const after = decodeCursor(opts.cursor);
  if (after) q = q.startAfter(Timestamp.fromMillis(Number(after)));
  const snap = await q.get();
  const docs = snap.docs.slice(0, limit);
  const last = docs[docs.length - 1];
  return {
    items: docs.map(toSummary),
    nextCursor:
      snap.docs.length > limit && last ? encodeCursor(String((last.get("updatedAt") as Timestamp).toMillis())) : null,
  };
}

export async function getUpdate(id: string): Promise<UpdateDoc | null> {
  const snap = await updatesCol().doc(id).get();
  return snap.exists ? toUpdate(snap) : null;
}

export async function createUpdate(actor: string, opts: { blank?: boolean } = {}): Promise<UpdateDoc> {
  const ref = updatesCol().doc();
  const title = "Untitled update";
  await ref.create({
    title,
    subject: "",
    previewText: "",
    content: opts.blank ? EMPTY_DOC : starterDocument(),
    bannerAssetId: null,
    attachmentIds: [],
    pdfDelivery: "attach",
    status: "draft",
    version: 1,
    searchTokens: titleTokens(title, ""),
    createdBy: actor,
    updatedBy: actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastRevisionAt: null,
    pendingCampaignId: null,
    sentCampaignId: null,
    sentAt: null,
    duplicatedFrom: null,
  });
  return (await getUpdate(ref.id))!;
}

export interface SaveInput {
  expectedVersion: number;
  title?: string;
  subject?: string;
  previewText?: string;
  content?: unknown;
  bannerAssetId?: string | null;
  attachmentIds?: string[];
  pdfDelivery?: PdfDelivery;
  revision?: "manual" | "autosave" | "restore";
}

/**
 * Save a draft with optimistic concurrency. Saving an update that is awaiting approval
 * returns it to draft and cancels the pending campaign, so an approval can never apply
 * to content that differs from what was reviewed.
 */
export async function saveUpdate(id: string, input: SaveInput, actor: string): Promise<UpdateDoc> {
  let content: DocNode | undefined;
  if (input.content !== undefined) {
    const parsed = parseDoc(input.content);
    if (!parsed.ok) throw badRequest(parsed.error);
    content = parsed.doc;
  }
  const ref = updatesCol().doc(id);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Update not found");
    const current = toUpdate(snap);
    if (!EDITABLE.includes(current.status)) {
      throw conflict("This update has been sent and can no longer be edited. Duplicate it to make changes.");
    }
    if (current.version !== input.expectedVersion) {
      throw conflict("This update was changed elsewhere. Reload to see the latest version.", {
        currentVersion: current.version,
      });
    }
    const pendingRef = current.pendingCampaignId ? db().collection("campaigns").doc(current.pendingCampaignId) : null;
    const pendingSnap = pendingRef ? await tx.get(pendingRef) : null;

    const next = {
      title: input.title ?? current.title,
      subject: input.subject ?? current.subject,
      previewText: input.previewText ?? current.previewText,
      content: content ?? current.content,
    };
    const lastRevisionAt = snap.get("lastRevisionAt") as Timestamp | null;
    const wantRevision =
      input.revision === "manual" ||
      input.revision === "restore" ||
      (input.revision === "autosave" &&
        (!lastRevisionAt || Date.now() - lastRevisionAt.toMillis() > AUTOSAVE_REVISION_INTERVAL_MS));

    if (pendingRef && pendingSnap?.exists && pendingSnap.get("status") === "pending_approval") {
      tx.update(pendingRef, {
        status: "cancelled",
        cancelledAt: FieldValue.serverTimestamp(),
        lastError: "Update was edited after review",
      });
    }
    tx.update(ref, {
      ...next,
      ...(input.bannerAssetId !== undefined ? { bannerAssetId: input.bannerAssetId } : {}),
      ...(input.attachmentIds ? { attachmentIds: [...new Set(input.attachmentIds)].slice(0, 10) } : {}),
      ...(input.pdfDelivery ? { pdfDelivery: input.pdfDelivery } : {}),
      searchTokens: titleTokens(next.title, next.subject),
      status: "draft",
      pendingCampaignId: null,
      version: current.version + 1,
      updatedBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      ...(wantRevision ? { lastRevisionAt: FieldValue.serverTimestamp() } : {}),
    });
    if (wantRevision) {
      tx.create(ref.collection("revisions").doc(), {
        ...next,
        version: current.version + 1,
        reason: input.revision,
        createdBy: actor,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return (await getUpdate(id))!;
}

export async function duplicateUpdate(id: string, actor: string): Promise<UpdateDoc> {
  const source = await getUpdate(id);
  if (!source) throw notFound("Update not found");
  const ref = updatesCol().doc();
  const title = `${source.title} (copy)`.slice(0, 200);
  await ref.create({
    title,
    subject: source.subject,
    previewText: source.previewText,
    content: source.content,
    bannerAssetId: source.bannerAssetId,
    attachmentIds: source.attachmentIds,
    pdfDelivery: source.pdfDelivery,
    status: "draft",
    version: 1,
    searchTokens: titleTokens(title, source.subject),
    createdBy: actor,
    updatedBy: actor,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastRevisionAt: null,
    pendingCampaignId: null,
    sentCampaignId: null,
    sentAt: null,
    duplicatedFrom: source.id,
  });
  return (await getUpdate(ref.id))!;
}

export async function deleteUpdate(id: string): Promise<void> {
  const ref = updatesCol().doc(id);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Update not found");
    const u = toUpdate(snap);
    if (!EDITABLE.includes(u.status)) throw conflict("Only drafts can be deleted. Sent updates are kept as a permanent record.");
    const pendingRef = u.pendingCampaignId ? db().collection("campaigns").doc(u.pendingCampaignId) : null;
    const pendingSnap = pendingRef ? await tx.get(pendingRef) : null;
    if (pendingRef && pendingSnap?.exists && pendingSnap.get("status") === "pending_approval") {
      tx.update(pendingRef, { status: "cancelled", cancelledAt: FieldValue.serverTimestamp(), lastError: "Draft deleted" });
    }
    tx.delete(ref);
  });
  await db().recursiveDelete(ref.collection("revisions"));
  await db().recursiveDelete(ref.collection("assistantMessages"));
}

function toRevision(snap: DocumentSnapshot, updateId: string): UpdateRevision {
  const d = data(snap);
  return {
    id: snap.id,
    updateId,
    title: str(d.title),
    subject: str(d.subject),
    previewText: str(d.previewText),
    content: contentOf(d.content),
    version: num(d.version),
    reason: (d.reason as UpdateRevision["reason"]) ?? "manual",
    createdBy: str(d.createdBy),
    createdAt: isoRequired(d.createdAt),
  };
}

export async function listRevisions(updateId: string, limit = 50): Promise<Omit<UpdateRevision, "content">[]> {
  const snap = await updatesCol().doc(updateId).collection("revisions").orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { content, ...rest } = toRevision(d, updateId);
    return rest;
  });
}

export async function getRevision(updateId: string, revisionId: string): Promise<UpdateRevision | null> {
  const snap = await updatesCol().doc(updateId).collection("revisions").doc(revisionId).get();
  return snap.exists ? toRevision(snap, updateId) : null;
}

export async function restoreRevision(updateId: string, revisionId: string, expectedVersion: number, actor: string) {
  const rev = await getRevision(updateId, revisionId);
  if (!rev) throw notFound("Revision not found");
  return saveUpdate(
    updateId,
    {
      expectedVersion,
      title: rev.title,
      subject: rev.subject,
      previewText: rev.previewText,
      content: rev.content,
      revision: "restore",
    },
    actor,
  );
}

export async function countUpdates(status: UpdateStatus): Promise<number> {
  const agg = await updatesCol().where("status", "==", status).count().get();
  return agg.data().count;
}

export async function listBlocks(): Promise<ContentBlock[]> {
  const snap = await blocksCol().orderBy("createdAt", "desc").limit(100).get();
  return snap.docs.map((d) => ({
    id: d.id,
    name: str(d.get("name")),
    content: migrateLegacyMetrics(contentOf(d.get("content"))),
    createdAt: isoRequired(d.get("createdAt")),
    createdBy: str(d.get("createdBy")),
  }));
}

export async function createBlock(name: string, content: unknown, actor: string): Promise<ContentBlock> {
  const parsed = parseDoc(content);
  if (!parsed.ok) throw badRequest(parsed.error);
  const ref = blocksCol().doc();
  await ref.create({ name: name.trim(), content: parsed.doc, createdBy: actor, createdAt: FieldValue.serverTimestamp() });
  return { id: ref.id, name: name.trim(), content: parsed.doc, createdAt: new Date().toISOString(), createdBy: actor };
}

export async function deleteBlock(id: string) {
  await blocksCol().doc(id).delete();
}
