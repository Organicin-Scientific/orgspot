import { audit } from "@/server/audit";
import { deleteBlock } from "@/server/db/updates";
import { ok, withAdmin } from "@/server/http/handler";

export const DELETE = withAdmin<{ id: string }>(async ({ params, session }) => {
  await deleteBlock(params.id);
  await audit({ actorEmail: session.email, action: "block.delete", resourceType: "block", resourceId: params.id, summary: "Deleted a reusable block" });
  return ok({ ok: true });
});
