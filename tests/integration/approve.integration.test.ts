import { beforeEach, describe, expect, it } from "vitest";
import { approveCampaign } from "@/server/campaigns/approve";
import { prepareCampaign } from "@/server/campaigns/prepare";
import { jobsCol } from "@/server/campaigns/repo";
import { clearEmulatorFirestore, createReadyUpdateForCampaign, createSyntheticGroupAndInvestors, resetServerModuleCaches, seedSendReadySettings } from "./helpers";

describe("approveCampaign concurrency and hash", () => {
  const actor = "approve.actor@example.com";

  beforeEach(async () => {
    resetServerModuleCaches();
    await clearEmulatorFirestore();
    await seedSendReadySettings(actor);
  });

  it("allows exactly one concurrent approval; wrong hash is rejected", async () => {
    const { groupId } = await createSyntheticGroupAndInvestors(actor);
    const update = await createReadyUpdateForCampaign(actor);
    const { snapshotHash, campaignId } = await prepareCampaign(update.id, { groupIds: [groupId], allActive: false }, actor);

    await expect(approveCampaign(campaignId, `${snapshotHash}00`, actor)).rejects.toThrow(/changed|review/i);

    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => approveCampaign(campaignId, snapshotHash, actor)));
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);
    for (const s of rejected) {
      if (s.status !== "rejected") continue;
      expect(String(s.reason)).toMatch(/already|queued|approved|awaiting/i);
    }

    const jobs = await jobsCol().get();
    expect(jobs.docs.length).toBe(1);
    expect(jobs.docs[0].id).toBe(campaignId);
  });
});
