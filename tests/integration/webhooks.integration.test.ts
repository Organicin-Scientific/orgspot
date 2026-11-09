import { beforeEach, describe, expect, it } from "vitest";
import { approveCampaign } from "@/server/campaigns/approve";
import { prepareCampaign } from "@/server/campaigns/prepare";
import { campaignsCol } from "@/server/campaigns/repo";
import { db } from "@/server/firebase-admin";
import { createGroup } from "@/server/db/groups";
import { createInvestor } from "@/server/db/investors";
import {
  adminRequest,
  clearEmulatorFirestore,
  createReadyUpdateForCampaign,
  drainWorkerUntil,
  resetServerModuleCaches,
  seedSendReadySettings,
  signResendWebhookPayload,
} from "./helpers";

function resendPayload(type: string, messageId: string, tags: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    type: `email.${type}`,
    created_at: new Date().toISOString(),
    data: {
      email_id: messageId,
      created_at: new Date().toISOString(),
      tags,
      ...extra,
    },
  };
}

describe("Resend webhook route", () => {
  const actor = "webhook.actor@example.com";
  let POST: typeof import("@/app/api/webhooks/resend/route").POST;

  beforeEach(async () => {
    resetServerModuleCaches();
    await clearEmulatorFirestore();
    await seedSendReadySettings(actor);
    const mod = await import("@/app/api/webhooks/resend/route");
    POST = mod.POST;
  });

  it("updates stats, dedupes by id, does not downgrade after higher precedence, rejects bad signature, adds suppression on bounce", async () => {
    const g = await createGroup({ name: "Webhook group", description: "test" }, actor);
    const bounceEmail = `bounce.${Date.now()}@example.com`;
    const inv = await createInvestor(
      {
        firstName: "Hook",
        lastName: "Test",
        email: bounceEmail,
        organization: "Example LLC",
        category: "Angel",
        notes: "",
        groupIds: [g.id],
      },
      actor,
    );
    const update = await createReadyUpdateForCampaign(actor);
    const { campaignId, snapshotHash } = await prepareCampaign(update.id, { groupIds: [g.id], allActive: false }, actor);
    await approveCampaign(campaignId, snapshotHash, actor);
    await drainWorkerUntil(async () => {
      const r = await campaignsCol().doc(campaignId).collection("recipients").doc(inv.id).get();
      return Boolean(r.get("providerMessageId"));
    });

    const recipientRef = campaignsCol().doc(campaignId).collection("recipients").doc(inv.id);
    const recipientDoc = await recipientRef.get();
    const messageId = recipientDoc.get("providerMessageId") as string;
    expect(messageId).toBeTruthy();
    const tags = { kind: "campaign", campaign_id: campaignId, recipient_id: inv.id };

    const secret = process.env.RESEND_WEBHOOK_SECRET!;

    const delivered = signResendWebhookPayload(secret, "evt-delivered-1", resendPayload("delivered", messageId, tags));
    const r1 = await POST(adminRequest("POST", "/api/webhooks/resend", { headers: delivered.headers, body: delivered.body }));
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as { result: string };
    expect(j1.result).toBe("applied");
    let stats = (await campaignsCol().doc(campaignId).get()).get("stats") as Record<string, number>;
    expect(stats.delivered).toBe(1);

    const rDup = await POST(adminRequest("POST", "/api/webhooks/resend", { headers: delivered.headers, body: delivered.body }));
    expect(rDup.status).toBe(200);
    expect(((await rDup.json()) as { result: string }).result).toBe("duplicate");
    stats = (await campaignsCol().doc(campaignId).get()).get("stats") as Record<string, number>;
    expect(stats.delivered).toBe(1);

    const bounced = signResendWebhookPayload(
      secret,
      "evt-bounce-1",
      resendPayload("bounced", messageId, tags, { bounce: { type: "Permanent" } }),
    );
    const rb = await POST(adminRequest("POST", "/api/webhooks/resend", { headers: bounced.headers, body: bounced.body }));
    expect(rb.status).toBe(200);
    expect(((await rb.json()) as { result: string }).result).toBe("applied");
    expect((await recipientRef.get()).get("status")).toBe("bounced");

    const delivered2 = signResendWebhookPayload(secret, "evt-delivered-2", resendPayload("delivered", messageId, tags));
    const rd = await POST(adminRequest("POST", "/api/webhooks/resend", { headers: delivered2.headers, body: delivered2.body }));
    expect(rd.status).toBe(200);
    expect(((await rd.json()) as { result: string }).result).toBe("applied");
    stats = (await campaignsCol().doc(campaignId).get()).get("stats") as Record<string, number>;
    expect(stats.delivered).toBe(1);
    expect(stats.bounced).toBeGreaterThanOrEqual(1);
    expect((await recipientRef.get()).get("status")).toBe("bounced");

    const bad = await POST(
      adminRequest("POST", "/api/webhooks/resend", {
        headers: { "content-type": "application/json" },
        body: '{"type":"email.delivered","data":{"email_id":"x"}}',
      }),
    );
    expect(bad.status).toBe(401);

    const sup = await db().collection("suppressionList").doc(bounceEmail.toLowerCase()).get();
    expect(sup.exists).toBe(true);
  });

  it("records complaint suppression for the recipient address", async () => {
    const g = await createGroup({ name: "Complaint group", description: "test" }, actor);
    const email = `spam.${Date.now()}@example.com`;
    const inv = await createInvestor(
      {
        firstName: "Spam",
        lastName: "Case",
        email,
        organization: "Example LLC",
        category: "Angel",
        notes: "",
        groupIds: [g.id],
      },
      actor,
    );
    const update = await createReadyUpdateForCampaign(actor);
    const { campaignId, snapshotHash } = await prepareCampaign(update.id, { groupIds: [g.id], allActive: false }, actor);
    await approveCampaign(campaignId, snapshotHash, actor);
    await drainWorkerUntil(async () => {
      const r = await campaignsCol().doc(campaignId).collection("recipients").doc(inv.id).get();
      return Boolean(r.get("providerMessageId"));
    });
    const messageId = (await campaignsCol().doc(campaignId).collection("recipients").doc(inv.id).get()).get("providerMessageId") as string;
    const secret = process.env.RESEND_WEBHOOK_SECRET!;
    const tags = { kind: "campaign", campaign_id: campaignId, recipient_id: inv.id };
    const complained = signResendWebhookPayload(secret, "evt-complaint-1", resendPayload("complained", messageId, tags));
    const rc = await POST(adminRequest("POST", "/api/webhooks/resend", { headers: complained.headers, body: complained.body }));
    expect(rc.status).toBe(200);
    const sup = await db().collection("suppressionList").doc(email.toLowerCase()).get();
    expect(sup.exists).toBe(true);
  });
});
