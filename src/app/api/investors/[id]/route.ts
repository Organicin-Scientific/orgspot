import { audit } from "@/server/audit";
import { deleteInvestor, getInvestor, rememberCategories, updateInvestor } from "@/server/db/investors";
import { notFound } from "@/server/http/errors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { investorPatch } from "@/server/http/schemas";

type P = { id: string };

export const GET = withAdmin<P>(async ({ params }) => {
  const investor = await getInvestor(params.id);
  if (!investor) throw notFound("Investor not found");
  return ok(investor);
});

export const PATCH = withAdmin<P>(async ({ req, params, session }) => {
  const patch = await readJson(req, investorPatch);
  const investor = await updateInvestor(params.id, patch, session.email);
  if (patch.category) await rememberCategories([patch.category]);
  await audit({
    actorEmail: session.email,
    action: "investor.update",
    resourceType: "investor",
    resourceId: params.id,
    summary: `Updated investor fields: ${Object.keys(patch).join(", ")}`,
  });
  return ok(investor);
});

export const DELETE = withAdmin<P>(async ({ params, session }) => {
  await deleteInvestor(params.id);
  await audit({
    actorEmail: session.email,
    action: "investor.delete",
    resourceType: "investor",
    resourceId: params.id,
    summary: "Removed an investor record",
  });
  return ok({ ok: true });
});
