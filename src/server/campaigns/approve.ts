import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { audit } from "../audit";
import { updatesCol } from "../db/updates";
import { db } from "../firebase-admin";
import { conflict, notFound, precondition } from "../http/errors";
import { publishAssets } from "../storage";
import { campaignsCol, jobsCol } from "./repo";

/**
 * The only path that can start a send. It runs in one transaction and requires:
 *  - the campaign is still `pending_approval`
 *  - the reviewer saw exactly this snapshot (hash match)
 *  - the update has not been edited since review and is not already sent/sending
 * The job document id equals the campaign id, so a second approval cannot create a
 * second job even under concurrent requests.
 */
export async function approveCampaign(campaignId: string, snapshotHash: string, actor: string) {
  const ref = campaignsCol().doc(campaignId);
  const pre = await ref.get();
  if (!pre.exists) throw notFound("Campaign not found");
  if (pre.get("snapshotHash") !== snapshotHash) {
    throw conflict("The campaign changed after you reviewed it. Please review it again.");
  }
  // Images must be reachable before the first message is sent.
  await publishAssets((pre.get("assetIds") as string[]) ?? []);

  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Campaign not found");
    const status = snap.get("status");
    if (status !== "pending_approval") {
      throw conflict(
        status === "cancelled"
          ? "This review was cancelled because the update changed. Please review again."
          : "This campaign has already been approved.",
      );
    }
    if (snap.get("snapshotHash") !== snapshotHash) {
      throw conflict("The campaign changed after you reviewed it. Please review it again.");
    }
    const updateId = snap.get("updateId") as string;
    const uref = updatesCol().doc(updateId);
    const jobRef = jobsCol().doc(campaignId);
    const [usnap, jobSnap] = await Promise.all([tx.get(uref), tx.get(jobRef)]);
    if (!usnap.exists) throw notFound("Update not found");
    if (jobSnap.exists) throw conflict("This campaign is already queued.");
    if (usnap.get("status") !== "ready" || usnap.get("pendingCampaignId") !== campaignId) {
      throw conflict("The update is no longer awaiting this approval. Please review again.");
    }
    if (usnap.get("version") !== snap.get("updateVersion")) {
      throw conflict("The update was edited after review. Please review again.");
    }
    if (((snap.get("stats.eligible") as number) ?? 0) < 1) throw precondition("No eligible recipients.");

    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      status: "queued",
      approved: true,
      approval: { approvedBy: actor, approvedAt: now },
      approvedAt: now,
    });
    tx.update(uref, { status: "sending", pendingCampaignId: null, sentCampaignId: campaignId });
    tx.create(jobRef, {
      type: "campaign.send",
      campaignId,
      status: "queued",
      runAfter: now,
      leaseUntil: null,
      leaseOwner: null,
      attempts: 0,
      createdAt: now,
    });
    return { title: snap.get("title") as string, eligible: snap.get("stats.eligible") as number };
  });

  await audit({
    actorEmail: actor,
    action: "campaign.approve",
    resourceType: "campaign",
    resourceId: campaignId,
    summary: `Approved "${result.title}" for ${result.eligible} recipients`,
  });
  return result;
}

export async function cancelPendingCampaign(campaignId: string, actor: string) {
  const ref = campaignsCol().doc(campaignId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Campaign not found");
    if (snap.get("status") !== "pending_approval") throw conflict("Only campaigns awaiting approval can be cancelled.");
    const uref = updatesCol().doc(snap.get("updateId") as string);
    const usnap = await tx.get(uref);
    tx.update(ref, { status: "cancelled", cancelledAt: FieldValue.serverTimestamp(), lastError: "Cancelled by reviewer" });
    if (usnap.exists && usnap.get("pendingCampaignId") === campaignId && usnap.get("status") === "ready") {
      tx.update(uref, { status: "draft", pendingCampaignId: null });
    }
  });
  await audit({ actorEmail: actor, action: "campaign.cancel", resourceType: "campaign", resourceId: campaignId, summary: "Cancelled a pending review" });
}
