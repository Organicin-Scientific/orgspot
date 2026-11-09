import "server-only";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { collectAssetIds } from "@/lib/content/schema";
import { templatePromptCount } from "@/lib/content/template";
import { emptyStats } from "@/lib/delivery";
import { normalizeEmail } from "@/lib/email-address";
import type { ExcludedRecipient, Investor } from "@/lib/types";
import { audit } from "../audit";
import { chunk } from "../db/convert";
import { iterateInvestors } from "../db/investors";
import { getGroup } from "../db/groups";
import { fullSendReadiness, getSettings } from "../db/settings";
import { suppressedSet } from "../db/suppression";
import { getUpdate, updatesCol } from "../db/updates";
import { emailProvider } from "../email";
import { renderUpdatePdf } from "../email/pdf";
import { GMAIL_CLIP_BYTES, renderUpdateEmail } from "../email/render";
import { db } from "../firebase-admin";
import { badRequest, conflict, notFound, precondition } from "../http/errors";
import { getAssets, writeFile } from "../storage";
import { campaignsCol, recipientsCol, snapshotPaths } from "./repo";

export const MAX_RECIPIENTS = 10_000;

export interface AudienceSelection {
  groupIds: string[];
  allActive: boolean;
}

export interface ResolvedAudience {
  selected: number;
  eligible: Investor[];
  excluded: ExcludedRecipient[];
  groupNames: string[];
}

/**
 * Union of the selected groups, deduplicated by investor and by normalised email, with
 * every non-active contact and every globally suppressed address excluded. Suppression is
 * global, so membership in another group can never bypass it.
 */
export async function resolveAudience(sel: AudienceSelection): Promise<ResolvedAudience> {
  const byId = new Map<string, Investor>();
  const groupNames: string[] = [];
  if (sel.allActive) {
    for await (const inv of iterateInvestors()) {
      byId.set(inv.id, inv);
      if (byId.size > MAX_RECIPIENTS * 2) throw badRequest("Audience is too large");
    }
  } else {
    for (const gid of [...new Set(sel.groupIds)]) {
      const group = await getGroup(gid);
      if (!group) throw badRequest("A selected group no longer exists");
      groupNames.push(group.name);
      for await (const inv of iterateInvestors({ groupId: gid })) {
        byId.set(inv.id, inv);
        if (byId.size > MAX_RECIPIENTS * 2) throw badRequest("Audience is too large");
      }
    }
  }

  const suppressed = await suppressedSet([...byId.values()].map((i) => i.email));
  const eligible: Investor[] = [];
  const excluded: ExcludedRecipient[] = [];
  const seenEmails = new Set<string>();
  const sorted = [...byId.values()].sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
  );
  for (const inv of sorted) {
    const key = normalizeEmail(inv.email);
    const name = `${inv.firstName} ${inv.lastName}`.trim();
    if (inv.status !== "active") {
      excluded.push({ investorId: inv.id, name, email: inv.email, reason: inv.status });
    } else if (suppressed.has(key)) {
      excluded.push({ investorId: inv.id, name, email: inv.email, reason: "suppression_list" });
    } else if (!seenEmails.has(key)) {
      seenEmails.add(key);
      eligible.push(inv);
    }
  }
  return { selected: byId.size, eligible, excluded, groupNames };
}

export async function senderDomainCheck(fromEmail: string): Promise<string | null> {
  const provider = emailProvider();
  if (!provider.live) return null;
  const domain = fromEmail.split("@")[1] ?? "";
  const status = await provider.domainStatus(domain);
  if (status.error) return `Could not verify the sending domain: ${status.error}`;
  if (!status.found) return `The sending domain ${domain} has not been added to Resend.`;
  if (!status.verified) return `The sending domain ${domain} is not verified yet (status: ${status.status}).`;
  return null;
}

export function snapshotHash(parts: {
  html: string;
  text: string;
  pdfSha: string | null;
  subject: string;
  previewText: string;
  sender: { fromName: string; fromEmail: string; replyTo: string };
  recipientIds: string[];
  pdfDelivery: string;
}): string {
  const h = createHash("sha256");
  for (const v of [
    parts.html,
    parts.text,
    parts.pdfSha ?? "",
    parts.subject,
    parts.previewText,
    parts.sender.fromName,
    parts.sender.fromEmail,
    parts.sender.replyTo,
    parts.pdfDelivery,
    ...[...parts.recipientIds].sort(),
  ]) {
    h.update(v).update("\u0000");
  }
  return h.digest("hex");
}

/**
 * Build the immutable campaign snapshot for review. Nothing is sent here: the campaign is
 * created in `pending_approval` and only an explicit approval creates a send job.
 */
export async function prepareCampaign(updateId: string, sel: AudienceSelection, actor: string) {
  if (!sel.allActive && sel.groupIds.length === 0) throw badRequest("Select at least one recipient group");
  const update = await getUpdate(updateId);
  if (!update) throw notFound("Update not found");
  if (update.status !== "draft" && update.status !== "ready") {
    throw conflict("This update has already been sent or is sending.");
  }
  if (!update.subject.trim()) throw precondition("Add an email subject before preparing a send.");
  const prompts = templatePromptCount(update.content);
  if (prompts > 0) {
    throw precondition(
      `Replace the ${prompts} template prompt${prompts === 1 ? "" : "s"} marked "[Write: …]" before sending. Test sends still work while you draft.`,
    );
  }

  const settings = await getSettings();
  const readiness = await fullSendReadiness(settings);
  if (!readiness.ready) throw precondition(readiness.problems[0], { problems: readiness.problems });
  const domainProblem = await senderDomainCheck(settings.sender.fromEmail);
  if (domainProblem) throw precondition(domainProblem);

  const audience = await resolveAudience(sel);
  if (audience.eligible.length === 0) throw precondition("No eligible recipients in the selected groups.");
  if (audience.eligible.length > MAX_RECIPIENTS) {
    throw precondition(`Campaigns are limited to ${MAX_RECIPIENTS.toLocaleString()} recipients.`);
  }

  const attachments = (await getAssets(update.attachmentIds)).filter((a) => a.kind === "attachment");
  const rendered = await renderUpdateEmail({
    title: update.title,
    subject: update.subject,
    previewText: update.previewText,
    content: update.content,
    bannerAssetId: update.bannerAssetId,
    pdfDelivery: update.pdfDelivery,
    attachments,
    settings,
    mode: "campaign",
  });
  if (rendered.sizeBytes > GMAIL_CLIP_BYTES) {
    throw precondition("The email is too large and Gmail would clip it. Shorten the update or remove images.");
  }

  const ref = campaignsCol().doc();
  const paths = snapshotPaths(ref.id);
  let pdfSha: string | null = null;
  if (update.pdfDelivery !== "none") {
    const pdf = await renderUpdatePdf({
      title: update.title,
      content: update.content,
      bannerAssetId: update.bannerAssetId,
      settings,
      dateLabel: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    });
    if (pdf.length > 15 * 1024 * 1024) throw precondition("The generated PDF is larger than 15 MB. Reduce image sizes.");
    pdfSha = createHash("sha256").update(pdf).digest("hex");
    await writeFile(paths.pdf, pdf, "application/pdf");
  }
  await writeFile(paths.html, rendered.html, "text/html; charset=utf-8");
  await writeFile(paths.text, rendered.text, "text/plain; charset=utf-8");

  const recipientIds = audience.eligible.map((i) => i.id);
  const hash = snapshotHash({
    html: rendered.html,
    text: rendered.text,
    pdfSha,
    subject: update.subject,
    previewText: update.previewText,
    sender: settings.sender,
    recipientIds,
    pdfDelivery: update.pdfDelivery,
  });

  // Recipient snapshot. Written before the campaign document so approval can never see a partial list.
  const now = FieldValue.serverTimestamp();
  for (const part of chunk(audience.eligible, 400)) {
    const batch = db().batch();
    for (const inv of part) {
      batch.set(recipientsCol(ref.id).doc(inv.id), {
        investorId: inv.id,
        email: inv.email.trim(),
        emailNormalized: normalizeEmail(inv.email),
        firstName: inv.firstName,
        lastName: inv.lastName,
        organization: inv.organization,
        sortKey: `${inv.lastName.toLowerCase()}\u0000${inv.firstName.toLowerCase()}\u0000${inv.id}`,
        status: "queued",
        attempts: 0,
        providerMessageId: null,
        lastError: null,
        queuedAt: now,
      });
    }
    await batch.commit();
  }
  for (const part of chunk(audience.excluded, 400)) {
    const batch = db().batch();
    for (const ex of part) {
      batch.set(ref.collection("excluded").doc(ex.investorId), { name: ex.name, email: ex.email, reason: ex.reason });
    }
    await batch.commit();
  }

  const stats = {
    ...emptyStats(),
    selected: audience.selected,
    eligible: audience.eligible.length,
    excluded: audience.excluded.length,
  };
  const assetIds = [
    ...collectAssetIds(update.content),
    ...(update.bannerAssetId ? [update.bannerAssetId] : []),
    ...(settings.branding.logoAssetId ? [settings.branding.logoAssetId] : []),
  ];

  try {
    await db().runTransaction(async (tx) => {
      const uref = updatesCol().doc(updateId);
      const usnap = await tx.get(uref);
      if (!usnap.exists) throw notFound("Update not found");
      const status = usnap.get("status");
      if (status !== "draft" && status !== "ready") throw conflict("This update has already been sent or is sending.");
      if (usnap.get("version") !== update.version) {
        throw conflict("The update changed while the send was being prepared. Please review again.");
      }
      const previous = usnap.get("pendingCampaignId") as string | null;
      const prevRef = previous ? campaignsCol().doc(previous) : null;
      const prevSnap = prevRef ? await tx.get(prevRef) : null;
      if (prevRef && prevSnap?.exists && prevSnap.get("status") === "pending_approval") {
        tx.update(prevRef, { status: "cancelled", cancelledAt: now, lastError: "Superseded by a newer review" });
      }
      tx.create(ref, {
        updateId,
        updateVersion: update.version,
        title: update.title,
        subject: update.subject,
        previewText: update.previewText,
        sender: settings.sender,
        branding: settings.branding,
        postalAddress: settings.postalAddress,
        audience: { groupIds: sel.allActive ? [] : sel.groupIds, groupNames: audience.groupNames, allActive: sel.allActive },
        pdfDelivery: update.pdfDelivery,
        attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, storagePath: a.storagePath })),
        assetIds: [...new Set(assetIds)],
        snapshotHash: hash,
        htmlBytes: rendered.sizeBytes,
        pdfSha,
        status: "pending_approval",
        approved: false,
        stats,
        searchTokens: tokensFor(update.title, update.subject),
        createdBy: actor,
        createdAt: now,
        approval: null,
        approvedAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        lastError: null,
      });
      tx.update(uref, { status: "ready", pendingCampaignId: ref.id });
    });
  } catch (err) {
    await db().recursiveDelete(ref).catch(() => undefined);
    throw err;
  }

  await audit({
    actorEmail: actor,
    action: "campaign.prepare",
    resourceType: "campaign",
    resourceId: ref.id,
    summary: `Prepared "${update.title}" for ${audience.eligible.length} recipients (${audience.excluded.length} excluded)`,
  });
  return { campaignId: ref.id, snapshotHash: hash, stats };
}

function tokensFor(title: string, subject: string): string[] {
  const tokens = new Set<string>();
  for (const w of `${title} ${subject}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    for (let n = 1; n <= Math.min(w.length, 15); n++) tokens.add(w.slice(0, n));
  }
  return [...tokens].slice(0, 200);
}
