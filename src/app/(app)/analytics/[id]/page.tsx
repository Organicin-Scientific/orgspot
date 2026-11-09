import { notFound } from "next/navigation";
import { getCampaign } from "@/server/campaigns/repo";
import { CampaignDetail } from "./campaign-detail";

export const metadata = { title: "Update analytics" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();
  return <CampaignDetail initial={campaign} />;
}
