import { audit } from "@/server/audit";
import { deleteGroup, getGroup, updateGroup } from "@/server/db/groups";
import { notFound } from "@/server/http/errors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { groupPatch } from "@/server/http/schemas";

type P = { id: string };

export const PATCH = withAdmin<P>(async ({ req, params, session }) => {
  const input = await readJson(req, groupPatch);
  const group = await updateGroup(params.id, input);
  await audit({ actorEmail: session.email, action: "group.update", resourceType: "group", resourceId: params.id, summary: `Updated group "${group.name}"` });
  return ok(group);
});

export const DELETE = withAdmin<P>(async ({ params, session }) => {
  const group = await getGroup(params.id);
  if (!group) throw notFound("Group not found");
  await deleteGroup(params.id);
  await audit({
    actorEmail: session.email,
    action: "group.delete",
    resourceType: "group",
    resourceId: params.id,
    summary: `Deleted group "${group.name}" (${group.memberCount} members kept as contacts)`,
  });
  return ok({ ok: true });
});
