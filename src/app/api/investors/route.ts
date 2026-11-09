import { audit } from "@/server/audit";
import { createInvestor, listInvestors, rememberCategories } from "@/server/db/investors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { investorInput, investorListQuery } from "@/server/http/schemas";

export const GET = withAdmin(async ({ req }) => {
  const query = investorListQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return ok(await listInvestors(query));
});

export const POST = withAdmin(async ({ req, session }) => {
  const input = await readJson(req, investorInput);
  const investor = await createInvestor(input, session.email);
  await rememberCategories([input.category]);
  await audit({
    actorEmail: session.email,
    action: "investor.create",
    resourceType: "investor",
    resourceId: investor.id,
    summary: "Added an investor manually",
  });
  return ok(investor, { status: 201 });
});
