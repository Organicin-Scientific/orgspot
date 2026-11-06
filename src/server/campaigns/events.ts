import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { applyProviderEvent, PROVIDER_EVENT_TYPES, type ProviderEventType, type RecipientDeliveryState } from "@/lib/delivery";
import type { RecipientStatus } from "@/lib/types";
import { audit } from "../audit";
import { iso, str } from "../db/convert";
import { suppressInTx } from "../db/suppression";
import { db } from "../firebase-admin";
import { log } from "../logger";
import { campaignsCol, eventsCol, providerMessagesCol, recipientsCol } from "./repo";

export interface IncomingEvent {
  /** Unique delivery id from the provider's webhook system (svix-id); used for deduplication. */
  id: string;
  type: ProviderEventType;
  messageId: string;
  occurredAt: string;
  tags: Record<string, string>;
  bounceType?: string;
  detail?: string;
}

/** Map a raw Resend webhook payload to our event model. Returns null for event types we ignore. */
export function normalizeResendEvent(id: string, payload: unknown): IncomingEvent | null {
  const p = payload as { type?: string; created_at?: string; data?: Record<string, unknown> };
  if (!p?.type?.startsWith("email.")) return null;
  const type = p.type.slice("email.".length) as ProviderEventType;
  if (!PROVIDER_EVENT_TYPES.includes(type)) return null;
  const d = p.data ?? {};
  const messageId = str(d.email_id);
  if (!messageId) return null;
  const rawTags = d.tags;
  const tags: Record<string, string> = {};
  if (Array.isArray(rawTags)) {
    for (const t of rawTags as { name?: string; value?: string }[]) if (t?.name) tags[t.name] = String(t.value ?? "");
  } else if (rawTags && typeof rawTags === "object") {
    for (const [k, v] of Object.entries(rawTags as Record<string, unknown>)) tags[k] = String(v);
  }
  const bounce = d.bounce as { type?: string; subType?: string } | undefined;
  const click = d.click as { link?: string } | undefined;
  const failed = d.failed as { reason?: string } | undefined;
  const occurred = str(d.created_at) || str(p.created_at) || new Date().toISOString();
  const occurredAt = Number.isNaN(Date.parse(occurred)) ? new Date().toISOString() : new Date(occurred).toISOString();
  let detail: string | undefined;
  if (bounce) detail = [bounce.type, bounce.subType].filter(Boolean).join(" / ");
  if (click?.link) {
    try {
      const u = new URL(click.link);
      detail = `${u.host}${u.pathname}`.slice(0, 200);
    } catch {
      detail = undefined;
    }
  }
  if (failed?.reason) detail = failed.reason.slice(0, 200);
  return { id, type, messageId, occurredAt, tags, bounceType: bounce?.type, detail };
}

export type IngestResult = "applied" | "duplicate" | "unmatched" | "test";

/**
 * Apply one provider event. Deduplication, the recipient state change, campaign counters
 * and any suppression are committed in a single transaction.
 */
export async function ingestEvent(ev: IncomingEvent): Promise<IngestResult> {
  const eventRef = eventsCol().doc(ev.id.replace(/\//g, "_").slice(0, 200));

  let campaignId: string | null = ev.tags.campaign_id ?? null;
  let recipientId: string | null = ev.tags.recipient_id ?? null;
  if (ev.tags.kind === "test") {
    await eventRef.create({
      type: ev.type,
      campaignId: null,
      recipientId: null,
      test: true,
      messageId: ev.messageId,
      occurredAt: Timestamp.fromDate(new Date(ev.occurredAt)),
      receivedAt: FieldValue.serverTimestamp(),
      detail: ev.detail ?? null,
    }).catch(() => undefined);
    return "test";
  }
  if (!campaignId || !recipientId) {
    const map = await providerMessagesCol().doc(ev.messageId).get();
    if (map.exists) {
      campaignId = str(map.get("campaignId")) || null;
      recipientId = str(map.get("recipientId")) || null;
    }
  }
  if (!campaignId || !recipientId) {
    const created = await eventRef
      .create({
        type: ev.type,
        campaignId: null,
        recipientId: null,
        messageId: ev.messageId,
        occurredAt: Timestamp.fromDate(new Date(ev.occurredAt)),
        receivedAt: FieldValue.serverTimestamp(),
        detail: ev.detail ?? null,
      })
      .then(() => true)
      .catch(() => false);
    if (created) log.warn("webhook.unmatched", { type: ev.type, messageId: ev.messageId });
    return created ? "unmatched" : "duplicate";
  }

  const cid = campaignId;
  const rid = recipientId;
  const result = await db().runTransaction(async (tx): Promise<IngestResult> => {
    const existing = await tx.get(eventRef);
    if (existing.exists) return "duplicate";
    const rref = recipientsCol(cid).doc(rid);
    const rsnap = await tx.get(rref);
    if (!rsnap.exists) {
      tx.create(eventRef, {
        type: ev.type,
        campaignId: cid,
        recipientId: rid,
        messageId: ev.messageId,
        occurredAt: Timestamp.fromDate(new Date(ev.occurredAt)),
        receivedAt: FieldValue.serverTimestamp(),
        detail: ev.detail ?? null,
        orphan: true,
      });
      return "unmatched";
    }
    const d = rsnap.data() ?? {};
    const state: RecipientDeliveryState = {
      status: (d.status as RecipientStatus) ?? "queued",
      acceptedAt: iso(d.acceptedAt),
      deliveredAt: iso(d.deliveredAt),
      bouncedAt: iso(d.bouncedAt),
      complainedAt: iso(d.complainedAt),
      failedAt: iso(d.failedAt),
      openedAt: iso(d.openedAt),
      clickedAt: iso(d.clickedAt),
    };
    const t = applyProviderEvent(state, { type: ev.type, occurredAt: ev.occurredAt, bounceType: ev.bounceType });
    const writeSuppression = t.suppress
      ? await suppressInTx(tx, str(d.email), t.suppress, `provider:${ev.type}`)
      : null;

    tx.create(eventRef, {
      type: ev.type,
      campaignId: cid,
      recipientId: rid,
      messageId: ev.messageId,
      occurredAt: Timestamp.fromDate(new Date(ev.occurredAt)),
      receivedAt: FieldValue.serverTimestamp(),
      detail: ev.detail ?? null,
    });
    if (t.changed) {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(t.patch)) {
        patch[k] = k === "status" ? v : Timestamp.fromDate(new Date(v as string));
      }
      if (t.patch.status && ["accepted", "delivered", "bounced", "complained", "failed"].includes(t.patch.status)) {
        // A provider event supersedes any in-flight lease or retry for this recipient.
        patch.leaseUntil = null;
        patch.nextAttemptAt = null;
      }
      if (!d.providerMessageId) patch.providerMessageId = ev.messageId;
      tx.update(rref, patch);
    }
    const statsPatch: Record<string, FieldValue> = {};
    for (const [k, v] of Object.entries(t.stats)) if (v) statsPatch[`stats.${k}`] = FieldValue.increment(v);
    if (Object.keys(statsPatch).length) tx.update(campaignsCol().doc(cid), statsPatch);
    writeSuppression?.();
    return "applied";
  });
  if (result === "applied" && (ev.type === "bounced" || ev.type === "complained" || ev.type === "failed")) {
    await audit({
      actorEmail: "system",
      action: "campaign.failure",
      resourceType: "campaign",
      resourceId: cid,
      summary: `Delivery ${ev.type}${ev.detail ? ` (${ev.detail})` : ""}`,
    });
  }
  return result;
}

/** Record an investor's unsubscribe from a campaign email. Idempotent. */
export async function unsubscribeRecipient(campaignId: string, recipientId: string): Promise<boolean> {
  const rref = recipientsCol(campaignId).doc(recipientId);
  const changed = await db().runTransaction(async (tx) => {
    const rsnap = await tx.get(rref);
    if (!rsnap.exists) return false;
    const write = await suppressInTx(tx, str(rsnap.get("email")), "unsubscribe", "recipient");
    const first = !rsnap.get("unsubscribedAt");
    if (first) {
      tx.update(rref, { unsubscribedAt: FieldValue.serverTimestamp() });
      tx.update(campaignsCol().doc(campaignId), { "stats.unsubscribed": FieldValue.increment(1) });
    }
    write();
    return first;
  });
  if (changed) {
    await audit({
      actorEmail: "recipient",
      action: "unsubscribe",
      resourceType: "campaign",
      resourceId: campaignId,
      summary: "A recipient unsubscribed",
    });
  }
  return changed;
}
