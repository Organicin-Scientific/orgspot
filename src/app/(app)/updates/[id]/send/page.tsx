import { notFound, redirect } from "next/navigation";
import { getCampaign } from "@/server/campaigns/repo";
import { countInvestors } from "@/server/db/investors";
import { listGroups } from "@/server/db/groups";
import { fullSendReadiness, getSettings } from "@/server/db/settings";
import { getUpdate } from "@/server/db/updates";
import { env } from "@/server/env";
import { SendFlow } from "./send-flow";

export const metadata = { title: "Review and send" };

export default async function SendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const update = await getUpdate(id);
  if (!update) notFound();
  if (update.sentCampaignId) redirect(`/analytics/${update.sentCampaignId}`);
  const [groups, activeCount, settings, pending] = await Promise.all([
    listGroups(),
    countInvestors("active"),
    getSettings(),
    update.pendingCampaignId ? getCampaign(update.pendingCampaignId) : Promise.resolve(null),
  ]);
  const readiness = await fullSendReadiness(settings);
  return (
    <SendFlow
      update={{ id: update.id, title: update.title, subject: update.subject, pdfDelivery: update.pdfDelivery }}
      groups={groups}
      activeCount={activeCount}
      readiness={readiness}
      liveSending={env().liveSending}
      pendingCampaignId={pending?.status === "pending_approval" ? pending.id : null}
    />
  );
}
