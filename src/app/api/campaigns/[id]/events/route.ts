import { listCampaignEvents } from "@/server/campaigns/repo";
import { ok, withAdmin } from "@/server/http/handler";

export const GET = withAdmin<{ id: string }>(async ({ req, params }) => {
  const recipientId = req.nextUrl.searchParams.get("recipientId") ?? undefined;
  if (recipientId && !/^[A-Za-z0-9_-]{1,64}$/.test(recipientId)) return ok([]);
  return ok(await listCampaignEvents(params.id, { recipientId, limit: recipientId ? 100 : 200 }));
});
