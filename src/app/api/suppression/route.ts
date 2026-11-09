import { audit } from "@/server/audit";
import { addSuppression, listSuppressions, removeSuppression } from "@/server/db/suppression";
import { notFound } from "@/server/http/errors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { suppressionInput, suppressionRemove } from "@/server/http/schemas";

export const GET = withAdmin(async ({ req }) => {
  return ok(await listSuppressions(req.nextUrl.searchParams.get("cursor")));
});

export const POST = withAdmin(async ({ req, session }) => {
  const { email } = await readJson(req, suppressionInput);
  await addSuppression(email, "manual", session.email);
  await audit({ actorEmail: session.email, action: "suppression.add", resourceType: "suppression", summary: "Added an address to the suppression list" });
  return ok({ ok: true }, { status: 201 });
});

/** Re-subscribing is deliberate: it requires an explicit confirmation flag. */
export const DELETE = withAdmin(async ({ req, session }) => {
  const { email } = await readJson(req, suppressionRemove);
  const removed = await removeSuppression(email, session.email);
  if (!removed) throw notFound("That address is not suppressed");
  await audit({ actorEmail: session.email, action: "suppression.remove", resourceType: "suppression", summary: "Removed an address from the suppression list" });
  return ok({ ok: true });
});
