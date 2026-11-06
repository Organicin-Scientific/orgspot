import { audit } from "@/server/audit";
import { bulkInvestors } from "@/server/db/investors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { bulkInput } from "@/server/http/schemas";

export const POST = withAdmin(async ({ req, session }) => {
  const { ids, action } = await readJson(req, bulkInput);
  const result = await bulkInvestors(ids, action, session.email);
  await audit({
    actorEmail: session.email,
    action: "investor.bulk",
    resourceType: "investor",
    summary: `Bulk ${action.type} on ${ids.length} selected contacts (${result.changed} changed)`,
  });
  return ok(result);
});
