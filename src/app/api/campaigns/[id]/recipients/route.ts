import { z } from "zod";
import { RECIPIENT_STATUSES } from "@/lib/types";
import { listRecipients } from "@/server/campaigns/repo";
import { ok, withAdmin } from "@/server/http/handler";

const query = z.object({
  status: z.enum(RECIPIENT_STATUSES).optional(),
  cursor: z.string().max(600).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withAdmin<{ id: string }>(async ({ req, params }) => {
  return ok(await listRecipients(params.id, query.parse(Object.fromEntries(req.nextUrl.searchParams))));
});
