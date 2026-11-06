import { audit } from "@/server/audit";
import { restoreRevision } from "@/server/db/updates";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { restoreInput } from "@/server/http/schemas";

export const POST = withAdmin<{ id: string }>(async ({ req, params, session }) => {
  const { revisionId, expectedVersion } = await readJson(req, restoreInput);
  const update = await restoreRevision(params.id, revisionId, expectedVersion, session.email);
  await audit({ actorEmail: session.email, action: "update.restore", resourceType: "update", resourceId: params.id, summary: `Restored a previous revision of "${update.title}"` });
  return ok(update);
});
