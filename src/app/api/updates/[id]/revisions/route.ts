import { getRevision, listRevisions } from "@/server/db/updates";
import { notFound } from "@/server/http/errors";
import { ok, withAdmin } from "@/server/http/handler";

export const GET = withAdmin<{ id: string }>(async ({ req, params }) => {
  const revisionId = req.nextUrl.searchParams.get("revisionId");
  if (revisionId) {
    const rev = await getRevision(params.id, revisionId);
    if (!rev) throw notFound("Revision not found");
    return ok(rev);
  }
  return ok(await listRevisions(params.id));
});
