import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { backoffMs, IDEMPOTENCY_WINDOW_MS, MAX_SEND_ATTEMPTS } from "@/lib/delivery";
import { normalizeEmail } from "@/lib/email-address";
import type { RecipientStatus } from "@/lib/types";
import { audit } from "../audit";
import { str } from "../db/convert";
import { suppressionCol } from "../db/suppression";
import { updatesCol } from "../db/updates";
import { emailProvider } from "../email";
import type { EmailProvider, OutgoingEmail } from "../email/provider";
import { PLACEHOLDERS, pdfFilename, personalize } from "../email/render";
import { sandboxOutcome } from "../email/sandbox-provider";
import { env } from "../env";
import { db } from "../firebase-admin";
import { log } from "../logger";
import { readFile } from "../storage";
import { fileToken, unsubscribeToken } from "../tokens";
import { ingestEvent } from "./events";
import { campaignsCol, jobsCol, providerMessagesCol, recipientsCol, snapshotPaths } from "./repo";

const JOB_LEASE_MS = 5 * 60_000;
const RECIPIENT_LEASE_MS = 2 * 60_000;
const PAGE = 25;

export interface WorkerResult {
  jobsProcessed: number;
  sent: number;
  remaining: boolean;
}

interface Snapshot {
  campaignId: string;
  html: string;
  text: string;
  subject: string;
  from: string;
  replyTo: string;
  title: string;
  pdfDelivery: "attach" | "link" | "none";
  pdf: Buffer | null;
  attachments: { id: string; filename: string }[];
  approvedAtMs: number;
}

class Pacer {
  private next = 0;
  constructor(private intervalMs: number) {}
  async wait() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

function formatFrom(name: string, email: string) {
  const safe = name.replace(/["\r\n<>]/g, "").trim();
  return safe ? `"${safe}" <${email}>` : email;
}

async function loadSnapshot(campaignId: string, c: DocumentSnapshot): Promise<Snapshot> {
  const paths = snapshotPaths(campaignId);
  const pdfDelivery = (c.get("pdfDelivery") as Snapshot["pdfDelivery"]) ?? "none";
  const [html, text, pdf] = await Promise.all([
    readFile(paths.html).then((b) => b.toString("utf8")),
    readFile(paths.text).then((b) => b.toString("utf8")),
    pdfDelivery === "attach" ? readFile(paths.pdf) : Promise.resolve(null),
  ]);
  const sender = (c.get("sender") ?? {}) as { fromName?: string; fromEmail?: string; replyTo?: string };
  const approvedAt = c.get("approvedAt") as Timestamp | null;
  return {
    campaignId,
    html,
    text,
    pdf,
    pdfDelivery,
    subject: str(c.get("subject")),
    title: str(c.get("title")),
    from: formatFrom(str(sender.fromName), str(sender.fromEmail)),
    replyTo: str(sender.replyTo),
    attachments: ((c.get("attachments") as { id: string; filename: string }[]) ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
    })),
    approvedAtMs: approvedAt?.toMillis() ?? Date.now(),
  };
}

/** Deterministic per-recipient message: identical on every retry so the idempotency key stays valid. */
export function buildRecipientEmail(s: Snapshot, recipientId: string, to: string): OutgoingEmail {
  const base = env().APP_URL;
  const unsub = `${base}/u/${unsubscribeToken(s.campaignId, recipientId)}`;
  const oneClick = `${base}/api/unsubscribe/${unsubscribeToken(s.campaignId, recipientId)}`;
  const expires = s.approvedAtMs + env().PDF_LINK_TTL_DAYS * 86_400_000;
  const values: Record<string, string> = {
    [PLACEHOLDERS.unsubscribe]: unsub,
    [PLACEHOLDERS.pdf]: `${base}/d/${fileToken(s.campaignId, recipientId, "update", expires)}`,
  };
  for (const a of s.attachments) values[PLACEHOLDERS.file(a.id)] = `${base}/d/${fileToken(s.campaignId, recipientId, a.id, expires)}`;
  return {
    from: s.from,
    to,
    replyTo: s.replyTo || undefined,
    subject: s.subject,
    html: personalize(s.html, values),
    text: personalize(s.text, values),
    headers: {
      "List-Unsubscribe": `<${oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: { kind: "campaign", campaign_id: s.campaignId, recipient_id: recipientId },
    attachments:
      s.pdfDelivery === "attach" && s.pdf
        ? [{ filename: pdfFilename(s.title), content: s.pdf, contentType: "application/pdf" }]
        : undefined,
    idempotencyKey: `campaign-${s.campaignId}-${recipientId}`,
  };
}

type Claim = { kind: "send"; email: string } | { kind: "skip" } | { kind: "none" };

/** Claim one recipient for sending inside a transaction. Returns what the worker should do. */
async function claimRecipient(campaignId: string, recipientId: string): Promise<Claim> {
  const ref = recipientsCol(campaignId).doc(recipientId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "none" } as Claim;
    const status = snap.get("status") as RecipientStatus;
    const now = Date.now();
    const lease = (snap.get("leaseUntil") as Timestamp | null)?.toMillis() ?? 0;
    const nextAttempt = (snap.get("nextAttemptAt") as Timestamp | null)?.toMillis() ?? 0;
    const eligible =
      status === "queued" ||
      (status === "retry_wait" && nextAttempt <= now) ||
      (status === "sending" && lease < now);
    if (!eligible) return { kind: "none" } as Claim;

    const firstAttempt = (snap.get("firstAttemptAt") as Timestamp | null)?.toMillis() ?? null;
    if (firstAttempt && now - firstAttempt > IDEMPOTENCY_WINDOW_MS && status !== "queued") {
      // Outside the provider's idempotency window we cannot prove the earlier attempt did not
      // send, so a human must decide rather than risk a duplicate.
      tx.update(ref, { status: "needs_review", leaseUntil: null, lastError: "Interrupted send outside the retry window" });
      return { kind: "none" } as Claim;
    }

    const email = str(snap.get("email"));
    const sup = await tx.get(suppressionCol().doc(normalizeEmail(email)));
    if (sup.exists) {
      tx.update(ref, { status: "skipped", leaseUntil: null, lastError: `Suppressed (${sup.get("reason")}) after approval` });
      tx.update(campaignsCol().doc(campaignId), { "stats.skipped": FieldValue.increment(1) });
      return { kind: "skip" } as Claim;
    }
    tx.update(ref, {
      status: "sending",
      leaseUntil: Timestamp.fromMillis(now + RECIPIENT_LEASE_MS),
      attempts: FieldValue.increment(1),
      lastAttemptAt: Timestamp.fromMillis(now),
      ...(firstAttempt ? {} : { firstAttemptAt: Timestamp.fromMillis(now) }),
    });
    return { kind: "send", email } as Claim;
  });
}

async function recordResult(
  campaignId: string,
  recipientId: string,
  result: Awaited<ReturnType<EmailProvider["send"]>>,
) {
  const ref = recipientsCol(campaignId).doc(recipientId);
  const cref = campaignsCol().doc(campaignId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const status = snap.get("status") as RecipientStatus;
    const attempts = (snap.get("attempts") as number) ?? 1;
    if (result.ok) {
      const patch: Record<string, unknown> = { providerMessageId: result.messageId, leaseUntil: null, nextAttemptAt: null, lastError: null };
      // A webhook may already have advanced the status; never move it backwards.
      if (["sending", "queued", "retry_wait"].includes(status)) patch.status = "accepted";
      if (!snap.get("acceptedAt")) {
        patch.acceptedAt = FieldValue.serverTimestamp();
        tx.update(cref, { "stats.accepted": FieldValue.increment(1) });
      }
      tx.update(ref, patch);
      tx.set(providerMessagesCol().doc(result.messageId), { campaignId, recipientId });
      return;
    }
    if (status !== "sending") return;
    if (result.needsReview) {
      tx.update(ref, { status: "needs_review", leaseUntil: null, lastError: `${result.code}: ${result.message}`.slice(0, 300) });
    } else if (result.retryable && attempts < MAX_SEND_ATTEMPTS) {
      tx.update(ref, {
        status: "retry_wait",
        leaseUntil: null,
        nextAttemptAt: Timestamp.fromMillis(Date.now() + backoffMs(attempts)),
        lastError: `${result.code}: ${result.message}`.slice(0, 300),
      });
    } else {
      tx.update(ref, {
        status: "failed",
        leaseUntil: null,
        lastError: `${result.code}: ${result.message}`.slice(0, 300),
        ...(snap.get("failedAt") ? {} : { failedAt: FieldValue.serverTimestamp() }),
      });
      if (!snap.get("failedAt")) tx.update(cref, { "stats.failed": FieldValue.increment(1) });
    }
  });
}

async function simulateSandboxEvents(campaignId: string, recipientId: string, email: string, messageId: string) {
  let i = 0;
  for (const type of sandboxOutcome(email)) {
    await ingestEvent({
      id: `sandbox-${messageId}-${type}`,
      type,
      messageId,
      occurredAt: new Date(Date.now() + i++ * 1000).toISOString(),
      tags: { kind: "campaign", campaign_id: campaignId, recipient_id: recipientId },
      bounceType: type === "bounced" ? "Permanent" : undefined,
    });
  }
}

async function nextBatch(campaignId: string): Promise<DocumentSnapshot[]> {
  const col = recipientsCol(campaignId);
  const now = Timestamp.now();
  const queued = await col.where("status", "==", "queued").limit(PAGE).get();
  if (!queued.empty) return queued.docs;
  const retry = await col.where("status", "==", "retry_wait").where("nextAttemptAt", "<=", now).limit(PAGE).get();
  if (!retry.empty) return retry.docs;
  const stale = await col.where("status", "==", "sending").where("leaseUntil", "<", now).limit(PAGE).get();
  return stale.docs;
}

async function finalizeIfDone(campaignId: string): Promise<{ done: boolean; runAfterMs: number }> {
  const col = recipientsCol(campaignId);
  const pending = await col.where("status", "in", ["queued", "sending", "retry_wait"]).count().get();
  if (pending.data().count > 0) {
    const due = await col.where("status", "==", "retry_wait").orderBy("nextAttemptAt").limit(1).get();
    const queued = await col.where("status", "in", ["queued", "sending"]).limit(1).get();
    const nextRetry = (due.docs[0]?.get("nextAttemptAt") as Timestamp | undefined)?.toMillis();
    const runAfterMs = !queued.empty ? Date.now() : (nextRetry ?? Date.now() + 60_000);
    return { done: false, runAfterMs };
  }
  const review = (await col.where("status", "==", "needs_review").count().get()).data().count;
  const cref = campaignsCol().doc(campaignId);
  let summary = "";
  await db().runTransaction(async (tx) => {
    const c = await tx.get(cref);
    if (!c.exists || ["sent", "partially_failed", "failed"].includes(c.get("status"))) return;
    const accepted = (c.get("stats.accepted") as number) ?? 0;
    const failed = (c.get("stats.failed") as number) ?? 0;
    const status = accepted === 0 ? "failed" : failed > 0 || review > 0 ? "partially_failed" : "sent";
    const uref = updatesCol().doc(c.get("updateId") as string);
    tx.update(cref, {
      status,
      completedAt: FieldValue.serverTimestamp(),
      needsReview: review,
      lastError: review > 0 ? `${review} recipient(s) need manual review` : failed > 0 ? `${failed} recipient(s) failed` : null,
    });
    tx.update(uref, { status: status === "failed" ? "failed" : "sent", sentAt: FieldValue.serverTimestamp() });
    tx.update(jobsCol().doc(campaignId), { status: "done", leaseUntil: null, completedAt: FieldValue.serverTimestamp() });
    summary = `"${c.get("title")}" finished: ${accepted} accepted, ${failed} failed${review ? `, ${review} need review` : ""}`;
  });
  if (summary) {
    await audit({ actorEmail: "system", action: "campaign.completed", resourceType: "campaign", resourceId: campaignId, summary });
  }
  return { done: true, runAfterMs: 0 };
}

async function claimJob(jobId: string, owner: string): Promise<boolean> {
  const ref = jobsCol().doc(jobId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const status = snap.get("status");
    const now = Date.now();
    const runAfter = (snap.get("runAfter") as Timestamp | null)?.toMillis() ?? 0;
    const lease = (snap.get("leaseUntil") as Timestamp | null)?.toMillis() ?? 0;
    const claimable = (status === "queued" && runAfter <= now) || (status === "running" && lease < now);
    if (!claimable) return false;
    tx.update(ref, {
      status: "running",
      leaseOwner: owner,
      leaseUntil: Timestamp.fromMillis(now + JOB_LEASE_MS),
      attempts: FieldValue.increment(1),
    });
    return true;
  });
}

async function releaseJob(jobId: string, owner: string, runAfterMs: number) {
  const ref = jobsCol().doc(jobId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("leaseOwner") !== owner || snap.get("status") !== "running") return;
    tx.update(ref, { status: "queued", leaseOwner: null, leaseUntil: null, runAfter: Timestamp.fromMillis(runAfterMs) });
  });
}

async function processCampaign(jobId: string, owner: string, deadline: number, provider: EmailProvider, pacer: Pacer) {
  const cref = campaignsCol().doc(jobId);
  const c = await cref.get();
  if (!c.exists || !["queued", "sending"].includes(c.get("status"))) {
    await jobsCol().doc(jobId).update({ status: "done", leaseUntil: null });
    return { sent: 0, remaining: false };
  }
  if (c.get("status") === "queued") {
    await cref.update({ status: "sending", startedAt: FieldValue.serverTimestamp() });
  }
  const snapshot = await loadSnapshot(jobId, c);
  let sent = 0;
  while (Date.now() < deadline) {
    const batch = await nextBatch(jobId);
    if (batch.length === 0) break;
    for (const doc of batch) {
      if (Date.now() >= deadline) break;
      await jobsCol().doc(jobId).update({ leaseUntil: Timestamp.fromMillis(Date.now() + JOB_LEASE_MS) });
      const claim = await claimRecipient(jobId, doc.id);
      if (claim.kind !== "send") continue;
      await pacer.wait();
      const message = buildRecipientEmail(snapshot, doc.id, claim.email);
      const result = await provider.send(message);
      await recordResult(jobId, doc.id, result);
      if (result.ok) {
        sent++;
        if (!provider.live) await simulateSandboxEvents(jobId, doc.id, claim.email, result.messageId);
      } else {
        log.warn("campaign.send_error", { campaignId: jobId, recipientId: doc.id, code: result.code, retryable: result.retryable });
      }
    }
  }
  const { done, runAfterMs } = await finalizeIfDone(jobId);
  if (!done) await releaseJob(jobId, owner, runAfterMs);
  return { sent, remaining: !done && runAfterMs <= Date.now() + 1000 };
}

/**
 * Process due send jobs until the time budget is spent. Safe to run concurrently: jobs and
 * recipients are claimed with transactional leases, and every provider call carries an
 * idempotency key. Invoked right after approval and by a cron schedule for recovery.
 */
export async function runWorker(budgetMs = 50_000): Promise<WorkerResult> {
  const deadline = Date.now() + budgetMs;
  const owner = randomUUID();
  const provider = emailProvider();
  const pacer = new Pacer(Math.ceil(1000 / env().RESEND_MAX_REQUESTS_PER_SECOND));
  let jobsProcessed = 0;
  let sent = 0;
  let remaining = false;
  const due = await jobsCol().where("status", "in", ["queued", "running"]).orderBy("runAfter").limit(10).get();
  for (const job of due.docs) {
    if (Date.now() >= deadline) {
      remaining = true;
      break;
    }
    if (!(await claimJob(job.id, owner))) continue;
    jobsProcessed++;
    try {
      const r = await processCampaign(job.id, owner, deadline, provider, pacer);
      sent += r.sent;
      remaining ||= r.remaining;
    } catch (err) {
      log.error("campaign.worker_error", { campaignId: job.id, err });
      await releaseJob(job.id, owner, Date.now() + 30_000).catch(() => undefined);
      remaining = true;
    }
  }
  return { jobsProcessed, sent, remaining };
}

/** Run the worker repeatedly until the queue is idle or the wall-clock budget is spent. */
export async function drainSendQueue(budgetMs: number): Promise<WorkerResult> {
  const deadline = Date.now() + budgetMs;
  const total: WorkerResult = { jobsProcessed: 0, sent: 0, remaining: false };
  while (Date.now() < deadline) {
    const slice = Math.min(50_000, deadline - Date.now());
    if (slice < 2_000) break;
    const r = await runWorker(slice);
    total.jobsProcessed += r.jobsProcessed;
    total.sent += r.sent;
    if (!r.remaining) return { ...total, remaining: false };
    total.remaining = true;
  }
  return total;
}
