import { getCampaign, snapshotPaths } from "@/server/campaigns/repo";
import { personalize, testPersonalization } from "@/server/email/render";
import { notFound } from "@/server/http/errors";
import { ok, withAdmin } from "@/server/http/handler";
import { readFile } from "@/server/storage";

/** The frozen email snapshot exactly as it was (or will be) sent, with sample personal links. */
export const GET = withAdmin<{ id: string }>(async ({ params }) => {
  const campaign = await getCampaign(params.id);
  if (!campaign) throw notFound("Campaign not found");
  const paths = snapshotPaths(params.id);
  const [html, text] = await Promise.all([readFile(paths.html), readFile(paths.text)]);
  const values = testPersonalization();
  return ok({ html: personalize(html.toString("utf8"), values), text: personalize(text.toString("utf8"), values) });
});
