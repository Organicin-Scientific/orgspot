import { audit } from "@/server/audit";
import { duplicateUpdate } from "@/server/db/updates";
import { ok, withAdmin } from "@/server/http/handler";

export const POST = withAdmin<{ id: string }>(async ({ params, session }) => {
  const copy = await duplicateUpdate(params.id, session.email);
  await audit({ actorEmail: session.email, action: "update.duplicate", resourceType: "update", resourceId: copy.id, summary: `Duplicated into "${copy.title}"` });
  return ok(copy, { status: 201 });
});
