import { prepareCampaign } from "@/server/campaigns/prepare";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { prepareInput } from "@/server/http/schemas";

export const maxDuration = 120;

/** Prepare a campaign for review. This never sends; approval is a separate, explicit step. */
export const POST = withAdmin<{ id: string }>(
  async ({ req, params, session }) => {
    const input = await readJson(req, prepareInput);
    return ok(await prepareCampaign(params.id, input, session.email), { status: 201 });
  },
  { rateLimit: "campaign" },
);
