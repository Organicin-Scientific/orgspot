import { parseDoc } from "@/lib/content/schema";
import { audit } from "@/server/audit";
import { createBlock, listBlocks } from "@/server/db/updates";
import { badRequest } from "@/server/http/errors";
import { ok, readJson, withAdmin } from "@/server/http/handler";
import { blockInput } from "@/server/http/schemas";

export const GET = withAdmin(async () => ok(await listBlocks()));

export const POST = withAdmin(async ({ req, session }) => {
  const { name, content } = await readJson(req, blockInput, 300_000);
  const parsed = parseDoc(content);
  if (!parsed.ok) throw badRequest(parsed.error);
  const block = await createBlock(name, parsed.doc, session.email);
  await audit({ actorEmail: session.email, action: "block.create", resourceType: "block", resourceId: block.id, summary: `Saved reusable block "${name}"` });
  return ok(block, { status: 201 });
});
