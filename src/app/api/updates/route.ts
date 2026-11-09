import { audit } from "@/server/audit";
import { createUpdate, listUpdates } from "@/server/db/updates";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { updateListQuery } from "@/server/http/schemas";
import { z } from "zod";

export const GET = withAdmin(async ({ req }) => {
  const query = updateListQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return ok(await listUpdates(query));
});

export const POST = withAdmin(async ({ req, session }) => {
  const { blank } = await readJson(req, z.object({ blank: z.boolean().default(false) }));
  const update = await createUpdate(session.email, { blank });
  await audit({ actorEmail: session.email, action: "update.create", resourceType: "update", resourceId: update.id, summary: "Created a new draft" });
  return ok(update, { status: 201 });
});
