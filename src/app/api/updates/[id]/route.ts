import { audit } from "@/server/audit";
import { deleteUpdate, getUpdate, saveUpdate } from "@/server/db/updates";
import { notFound } from "@/server/http/errors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { updateSave } from "@/server/http/schemas";

type P = { id: string };

export const GET = withAdmin<P>(async ({ params }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  return ok(update);
});

export const PATCH = withAdmin<P>(async ({ req, params, session }) => {
  const input = await readJson(req, updateSave, 800_000);
  const update = await saveUpdate(params.id, input, session.email);
  if (input.revision === "manual") {
    await audit({ actorEmail: session.email, action: "update.save", resourceType: "update", resourceId: params.id, summary: `Saved "${update.title}" (v${update.version})` });
  }
  return ok(update);
});

export const DELETE = withAdmin<P>(async ({ params, session }) => {
  const update = await getUpdate(params.id);
  if (!update) throw notFound("Update not found");
  await deleteUpdate(params.id);
  await audit({ actorEmail: session.email, action: "update.delete", resourceType: "update", resourceId: params.id, summary: `Deleted draft "${update.title}"` });
  return ok({ ok: true });
});
