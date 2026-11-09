import { cancelPendingCampaign } from "@/server/campaigns/approve";
import { ok, withAdmin } from "@/server/http/handler";

/** Discard a prepared-but-unapproved campaign. Campaigns that are already sending cannot be recalled. */
export const POST = withAdmin<{ id: string }>(async ({ params, session }) => {
  await cancelPendingCampaign(params.id, session.email);
  return ok({ ok: true });
});
