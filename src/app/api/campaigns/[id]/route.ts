import { campaignRates } from "@/lib/analytics";
import { getCampaign, listExcluded } from "@/server/campaigns/repo";
import { emailProvider } from "@/server/email";
import { notFound } from "@/server/http/errors";
import { ok, withAdmin } from "@/server/http/handler";

export const GET = withAdmin<{ id: string }>(async ({ params }) => {
  const campaign = await getCampaign(params.id);
  if (!campaign) throw notFound("Campaign not found");
  const excluded = await listExcluded(params.id);
  return ok({
    campaign,
    rates: campaignRates(campaign.stats),
    excluded,
    delivery: { live: emailProvider().live, provider: emailProvider().name },
  });
});
