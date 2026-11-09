import { audit } from "@/server/audit";
import { createGroup, listGroups } from "@/server/db/groups";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { groupInput } from "@/server/http/schemas";

export const GET = withAdmin(async () => ok(await listGroups()));

export const POST = withAdmin(async ({ req, session }) => {
  const input = await readJson(req, groupInput);
  const group = await createGroup(input, session.email);
  await audit({ actorEmail: session.email, action: "group.create", resourceType: "group", resourceId: group.id, summary: `Created group "${group.name}"` });
  return ok(group, { status: 201 });
});
