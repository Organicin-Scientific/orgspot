import "server-only";
import { Timestamp, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { emptyStats } from "@/lib/delivery";
import type {
  Campaign,
  CampaignRecipient,
  CampaignStats,
  CampaignStatus,
  EmailEvent,
  ExcludedRecipient,
  Page,
  PdfDelivery,
  RecipientStatus,
} from "@/lib/types";
import { db } from "../firebase-admin";
import { data, decodeCursor, encodeCursor, iso, isoRequired, num, str } from "../db/convert";

export const campaignsCol = () => db().collection("campaigns");
export const recipientsCol = (campaignId: string) => campaignsCol().doc(campaignId).collection("recipients");
export const jobsCol = () => db().collection("jobs");
export const eventsCol = () => db().collection("emailEvents");
export const providerMessagesCol = () => db().collection("providerMessages");

export function toCampaign(snap: DocumentSnapshot): Campaign {
  const d = data(snap);
  const stats = { ...emptyStats(), ...((d.stats as Partial<CampaignStats>) ?? {}) };
  const approval = d.approval as { approvedBy?: string; approvedAt?: unknown } | null | undefined;
  const audience = (d.audience ?? {}) as Partial<Campaign["audience"]>;
  const sender = (d.sender ?? {}) as Partial<Campaign["sender"]>;
  return {
    id: snap.id,
    updateId: str(d.updateId),
    updateVersion: num(d.updateVersion),
    title: str(d.title),
    subject: str(d.subject),
    previewText: str(d.previewText),
    sender: { fromName: str(sender.fromName), fromEmail: str(sender.fromEmail), replyTo: str(sender.replyTo) },
    audience: {
      groupIds: audience.groupIds ?? [],
      groupNames: audience.groupNames ?? [],
      allActive: audience.allActive === true,
    },
    pdfDelivery: (d.pdfDelivery as PdfDelivery) ?? "none",
    snapshotHash: str(d.snapshotHash),
    status: (d.status as CampaignStatus) ?? "pending_approval",
    stats,
    createdBy: str(d.createdBy),
    createdAt: isoRequired(d.createdAt),
    approval: approval?.approvedBy ? { approvedBy: approval.approvedBy, approvedAt: isoRequired(approval.approvedAt) } : null,
    startedAt: iso(d.startedAt),
    completedAt: iso(d.completedAt),
    cancelledAt: iso(d.cancelledAt),
    lastError: typeof d.lastError === "string" ? d.lastError : null,
  };
}

export function toRecipient(snap: DocumentSnapshot, campaignId: string): CampaignRecipient {
  const d = data(snap);
  return {
    id: snap.id,
    campaignId,
    investorId: str(d.investorId),
    email: str(d.email),
    firstName: str(d.firstName),
    lastName: str(d.lastName),
    organization: str(d.organization),
    status: (d.status as RecipientStatus) ?? "queued",
    attempts: num(d.attempts),
    providerMessageId: typeof d.providerMessageId === "string" ? d.providerMessageId : null,
    lastError: typeof d.lastError === "string" ? d.lastError : null,
    queuedAt: isoRequired(d.queuedAt),
    acceptedAt: iso(d.acceptedAt),
    deliveredAt: iso(d.deliveredAt),
    bouncedAt: iso(d.bouncedAt),
    complainedAt: iso(d.complainedAt),
    failedAt: iso(d.failedAt),
    openedAt: iso(d.openedAt),
    clickedAt: iso(d.clickedAt),
    unsubscribedAt: iso(d.unsubscribedAt),
  };
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const snap = await campaignsCol().doc(id).get();
  return snap.exists ? toCampaign(snap) : null;
}

export async function listCampaigns(opts: {
  status?: CampaignStatus;
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<Page<Campaign>> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  let q: Query = campaignsCol();
  // `approved` is set when a campaign is approved, so drafts awaiting review never appear in history.
  q = opts.status ? q.where("status", "==", opts.status) : q.where("approved", "==", true);
  const term = (opts.q ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0];
  if (term) q = q.where("searchTokens", "array-contains", term.slice(0, 15));
  q = q.orderBy("approvedAt", "desc").limit(limit + 1);
  const after = decodeCursor(opts.cursor);
  if (after) q = q.startAfter(Timestamp.fromMillis(Number(after)));
  const snap = await q.get();
  const docs = snap.docs.slice(0, limit);
  const last = docs[docs.length - 1];
  return {
    items: docs.map(toCampaign),
    nextCursor:
      snap.docs.length > limit && last ? encodeCursor(String((last.get("approvedAt") as Timestamp).toMillis())) : null,
  };
}

export async function recentSentCampaigns(limit = 50): Promise<Campaign[]> {
  const snap = await campaignsCol()
    .where("approved", "==", true)
    .orderBy("approvedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(toCampaign);
}

export async function listRecipients(
  campaignId: string,
  opts: { status?: RecipientStatus; cursor?: string | null; limit?: number },
): Promise<Page<CampaignRecipient>> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let q: Query = recipientsCol(campaignId);
  if (opts.status) q = q.where("status", "==", opts.status);
  q = q.orderBy("sortKey").limit(limit + 1);
  const after = decodeCursor(opts.cursor);
  if (after) q = q.startAfter(after);
  const snap = await q.get();
  const docs = snap.docs.slice(0, limit);
  return {
    items: docs.map((d) => toRecipient(d, campaignId)),
    nextCursor: snap.docs.length > limit ? encodeCursor(str(docs[docs.length - 1].get("sortKey"))) : null,
  };
}

export async function listExcluded(campaignId: string, limit = 500): Promise<ExcludedRecipient[]> {
  const snap = await campaignsCol().doc(campaignId).collection("excluded").limit(limit).get();
  return snap.docs.map((d) => ({
    investorId: d.id,
    name: str(d.get("name")),
    email: str(d.get("email")),
    reason: d.get("reason") as ExcludedRecipient["reason"],
  }));
}

function toEvent(snap: DocumentSnapshot): EmailEvent {
  const d = data(snap);
  return {
    id: snap.id,
    type: str(d.type),
    campaignId: typeof d.campaignId === "string" ? d.campaignId : null,
    recipientId: typeof d.recipientId === "string" ? d.recipientId : null,
    occurredAt: isoRequired(d.occurredAt),
    receivedAt: isoRequired(d.receivedAt),
    detail: typeof d.detail === "string" ? d.detail : null,
  };
}

export async function listCampaignEvents(campaignId: string, opts: { recipientId?: string; limit?: number } = {}) {
  let q: Query = eventsCol().where("campaignId", "==", campaignId);
  if (opts.recipientId) q = q.where("recipientId", "==", opts.recipientId);
  const snap = await q.orderBy("occurredAt", "desc").limit(Math.min(opts.limit ?? 100, 500)).get();
  return snap.docs.map(toEvent);
}

/** Campaign history for one investor (collection-group query on recipient docs). */
export async function recipientHistory(investorId: string, limit = 50) {
  const snap = await db()
    .collectionGroup("recipients")
    .where("investorId", "==", investorId)
    .orderBy("queuedAt", "desc")
    .limit(limit)
    .get();
  const rows = snap.docs.map((d) => toRecipient(d, d.ref.parent.parent!.id));
  const campaigns = new Map<string, Campaign>();
  const ids = [...new Set(rows.map((r) => r.campaignId))];
  if (ids.length) {
    const snaps = await db().getAll(...ids.map((id) => campaignsCol().doc(id)));
    for (const s of snaps) if (s.exists) campaigns.set(s.id, toCampaign(s));
  }
  return rows
    .map((r) => ({ recipient: r, campaign: campaigns.get(r.campaignId) ?? null }))
    .filter((r) => r.campaign && r.campaign.status !== "pending_approval" && r.campaign.status !== "cancelled");
}

export function snapshotPaths(campaignId: string) {
  return {
    html: `campaigns/${campaignId}/email.html`,
    text: `campaigns/${campaignId}/email.txt`,
    pdf: `campaigns/${campaignId}/update.pdf`,
  };
}
