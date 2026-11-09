import { beforeEach, describe, expect, it } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { approveCampaign } from "@/server/campaigns/approve";
import { prepareCampaign } from "@/server/campaigns/prepare";
import { runWorker } from "@/server/campaigns/worker";
import { campaignsCol, jobsCol, recipientsCol } from "@/server/campaigns/repo";
import { db } from "@/server/firebase-admin";
import {
  clearEmulatorFirestore,
  createReadyUpdateForCampaign,
  createSyntheticGroupAndInvestors,
  drainWorkerUntil,
  resetServerModuleCaches,
  seedSendReadySettings,
} from "./helpers";

describe("campaign worker (sandbox)", () => {
  const actor = "worker.actor@example.com";

  beforeEach(async () => {
    resetServerModuleCaches();
    await clearEmulatorFirestore();
    await seedSendReadySettings(actor);
  });

  it("sends once per eligible recipient, skips suppressed-at-prepare, retries flaky, completes as sent", async () => {
    const { groupId, investors, suppressedEmail, postSuppressEmail } = await createSyntheticGroupAndInvestors(actor);
    const update = await createReadyUpdateForCampaign(actor);
    const { campaignId, snapshotHash } = await prepareCampaign(update.id, { groupIds: [groupId], allActive: false }, actor);

    const campRef = campaignsCol().doc(campaignId);
    const pre = await campRef.get();
    expect(pre.get("stats.eligible")).toBe(3);
    expect(pre.get("stats.excluded")).toBeGreaterThanOrEqual(1);

    await db()
      .collection("suppressionList")
      .doc(postSuppressEmail.toLowerCase())
      .set({
        email: postSuppressEmail.toLowerCase(),
        reason: "bounce",
        source: "test-post-prepare",
        createdAt: FieldValue.serverTimestamp(),
      });

    await approveCampaign(campaignId, snapshotHash, actor);

    const [w1, w2] = await Promise.all([runWorker(120_000), runWorker(120_000)]);
    expect(w1.jobsProcessed + w2.jobsProcessed).toBeGreaterThanOrEqual(1);

    const flaky = investors.find((i) => i.email.endsWith("@flaky.test"));
    const suppressed = investors.find((i) => i.email === suppressedEmail);
    const postSuppress = investors.find((i) => i.email === postSuppressEmail);
    expect(flaky).toBeDefined();
    expect(suppressed).toBeDefined();
    expect(postSuppress).toBeDefined();
    const flakyRef = recipientsCol(campaignId).doc(flaky!.id);

    await runWorker(120_000);

    const flakySnap = await flakyRef.get();
    if (flakySnap.get("status") === "retry_wait") {
      await flakyRef.update({ nextAttemptAt: Timestamp.fromMillis(Date.now() - 1000) });
      await jobsCol().doc(campaignId).update({
        status: "queued",
        leaseUntil: null,
        leaseOwner: null,
        runAfter: Timestamp.fromMillis(Date.now() - 1000),
      });
    } else if (flakySnap.get("status") === "sending") {
      await flakyRef.update({ leaseUntil: Timestamp.fromMillis(Date.now() - 1000) });
    }

    await drainWorkerUntil(async () => {
      const s = (await campRef.get()).get("status");
      return s !== "sending" && s !== "queued";
    });

    const camp = await campRef.get();
    expect(camp.get("status")).toBe("sent");
    expect(camp.get("stats.skipped")).toBe(1);

    const out = await db().collection("sandboxOutbox").get();
    expect(out.docs.length).toBe(2);
    for (const d of out.docs) {
      expect(Number(d.get("sends") ?? 1)).toBeGreaterThanOrEqual(1);
    }

    expect((await recipientsCol(campaignId).doc(suppressed!.id).get()).exists).toBe(false);
    expect((await recipientsCol(campaignId).doc(postSuppress!.id).get()).get("status")).toBe("skipped");
    expect((await flakyRef.get()).get("status")).toBe("delivered");
  });
});
