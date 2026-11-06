import { z } from "zod";
import { CAMPAIGN_STATUSES } from "@/lib/types";
import { listCampaigns } from "@/server/campaigns/repo";
import { ok, withAdmin } from "@/server/http/handler";

const query = z.object({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const GET = withAdmin(async ({ req }) => {
  return ok(await listCampaigns(query.parse(Object.fromEntries(req.nextUrl.searchParams))));
});
