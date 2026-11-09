import { recipientHistory } from "@/server/campaigns/repo";
import { investorHistory } from "@/server/db/investors";
import { ok, withAdmin } from "@/server/http/handler";

export const GET = withAdmin<{ id: string }>(async ({ params }) => {
  const [changes, campaigns] = await Promise.all([investorHistory(params.id), recipientHistory(params.id)]);
  return ok({ changes, campaigns });
});
